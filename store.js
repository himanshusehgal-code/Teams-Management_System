// Storage adapters. Every adapter implements: init(), test(), get(name), set(name, value)
// Names: meta (object), employees, masters, tasks, archive (arrays). Pick one with STORAGE=postgres|sheets|file
const path = require('path');
const kind = (process.env.STORAGE || 'file').toLowerCase();
const empty = n => (n === 'meta' ? null : []);
let impl;

if (kind === 'postgres') {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL || '';
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  impl = {
    async init() {
      await pool.query('CREATE TABLE IF NOT EXISTS _meta(key text PRIMARY KEY, value text)');
      await pool.query('CREATE TABLE IF NOT EXISTS app_data(name text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now())');
      await pool.query("INSERT INTO _meta VALUES('schema','1') ON CONFLICT DO NOTHING");
    },
    async test() { await pool.query('select 1'); return 'Connected to Postgres.'; },
    async get(n) {
      try {
        const r = await pool.query('select data from app_data where name=$1', [n]);
        return r.rows[0] ? r.rows[0].data : empty(n);
      } catch (e) { if (e.code === '42P01') return empty(n); throw e; }
    },
    async set(n, v) {
      await pool.query('insert into app_data(name,data) values($1,$2) on conflict(name) do update set data=$2, updated_at=now()', [n, JSON.stringify(v)]);
    }
  };
} else if (kind === 'sheets') {
  const { sheets, auth } = require('@googleapis/sheets');
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  const sh = sheets({ version: 'v4', auth: new auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
  const id = process.env.SHEET_ID;
  const T = { meta: 'Meta', employees: 'Employees', masters: 'Masters', tasks: 'Tasks', archive: 'Archive' };
  impl = {
    async test() { const r = await sh.spreadsheets.get({ spreadsheetId: id }); return 'Connected to Google Sheet "' + r.data.properties.title + '".'; },
    async init() {
      const r = await sh.spreadsheets.get({ spreadsheetId: id });
      const have = r.data.sheets.map(s => s.properties.title);
      const add = Object.values(T).filter(t => !have.includes(t));
      if (add.length) await sh.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: add.map(title => ({ addSheet: { properties: { title } } })) } });
    },
    async get(n) {
      try {
        const r = await sh.spreadsheets.values.get({ spreadsheetId: id, range: T[n] + '!A:A' });
        const rows = (r.data.values || []).map(v => JSON.parse(v[0]));
        return n === 'meta' ? (rows[0] || null) : rows;
      } catch (e) { console.error('Sheets read failed:', e.message); return empty(n); }
    },
    async set(n, v) {
      const rows = (n === 'meta' ? [v] : v).map(x => [JSON.stringify(x)]);
      await sh.spreadsheets.values.clear({ spreadsheetId: id, range: T[n] + '!A:A' });
      if (rows.length) await sh.spreadsheets.values.update({ spreadsheetId: id, range: T[n] + '!A1', valueInputOption: 'RAW', requestBody: { values: rows } });
    }
  };
} else {
  const fs = require('fs');
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  impl = {
    async init() { fs.mkdirSync(dir, { recursive: true }); },
    async test() { await this.init(); return 'Using local file storage. Not durable on free Render.'; },
    async get(n) { try { return JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8')); } catch { return empty(n); } },
    async set(n, v) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, n + '.json'), JSON.stringify(v)); }
  };
}
module.exports = Object.assign(impl, { kind });
