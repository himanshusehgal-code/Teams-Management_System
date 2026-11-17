// Storage adapters. Every adapter implements: init(), test(), get(name), set(name, value)
// Names: meta (object), employees, masters, tasks, archive (arrays). Pick one with STORAGE=postgres|sheets|file
const path = require('path');
const fs = require('fs');

const empty = n => (n === 'meta' ? null : []);
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const configPath = path.join(dataDir, 'config.json');

function readSavedConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

function createPostgresAdapter(url) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }
  });
  return {
    kind: 'postgres',
    url,
    pool,
    async init() {
      await pool.query('CREATE TABLE IF NOT EXISTS _meta(key text PRIMARY KEY, value text)');
      await pool.query('CREATE TABLE IF NOT EXISTS app_data(name text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now())');
      await pool.query("INSERT INTO _meta VALUES('schema','1') ON CONFLICT DO NOTHING");
    },
    async test() {
      await pool.query('select 1');
      return 'Connected to Postgres.';
    },
    async get(n) {
      try {
        const r = await pool.query('select data from app_data where name=$1', [n]);
        return r.rows[0] ? r.rows[0].data : empty(n);
      } catch (e) {
        if (e.code === '42P01') return empty(n);
        throw e;
      }
    },
    async set(n, v) {
      await pool.query(
        'insert into app_data(name,data) values($1,$2) on conflict(name) do update set data=$2, updated_at=now()',
        [n, JSON.stringify(v)]
      );
    },
    async close() {
      await pool.end().catch(() => {});
    }
  };
}

function createSheetsAdapter(id, credsJson) {
  const { sheets, auth } = require('@googleapis/sheets');
  const creds = typeof credsJson === 'string' ? JSON.parse(credsJson || '{}') : (credsJson || {});
  const sh = sheets({
    version: 'v4',
    auth: new auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    })
  });
  const T = { meta: 'Meta', employees: 'Employees', masters: 'Masters', tasks: 'Tasks', archive: 'Archive' };
  return {
    kind: 'sheets',
    async test() {
      const r = await sh.spreadsheets.get({ spreadsheetId: id });
      return 'Connected to Google Sheet "' + r.data.properties.title + '".';
    },
    async init() {
      const r = await sh.spreadsheets.get({ spreadsheetId: id });
      const have = r.data.sheets.map(s => s.properties.title);
      const add = Object.values(T).filter(t => !have.includes(t));
      if (add.length) {
        await sh.spreadsheets.batchUpdate({
          spreadsheetId: id,
          requestBody: { requests: add.map(title => ({ addSheet: { properties: { title } } })) }
        });
      }
    },
    async get(n) {
      try {
        const r = await sh.spreadsheets.values.get({ spreadsheetId: id, range: T[n] + '!A:A' });
        const rows = (r.data.values || []).map(v => JSON.parse(v[0]));
        return n === 'meta' ? (rows[0] || null) : rows;
      } catch (e) {
        console.error('Sheets read failed:', e.message);
        return empty(n);
      }
    },
    async set(n, v) {
      const rows = (n === 'meta' ? [v] : v).map(x => [JSON.stringify(x)]);
      await sh.spreadsheets.values.clear({ spreadsheetId: id, range: T[n] + '!A:A' });
      if (rows.length) {
        await sh.spreadsheets.values.update({
          spreadsheetId: id,
          range: T[n] + '!A1',
          valueInputOption: 'RAW',
          requestBody: { values: rows }
        });
      }
    }
  };
}

function createFileAdapter(dir) {
  const d = dir || dataDir;
  return {
    kind: 'file',
    async init() {
      fs.mkdirSync(d, { recursive: true });
    },
    async test() {
      await this.init();
      return 'Using local file storage. Note: Requires Render Starter plan ($7/mo + $0.25/GB disk) to persist on Render.';
    },
    async get(n) {
      try {
        return JSON.parse(fs.readFileSync(path.join(d, n + '.json'), 'utf8'));
      } catch {
        return empty(n);
      }
    },
    async set(n, v) {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, n + '.json'), JSON.stringify(v));
    }
  };
}

let currentAdapter = null;

function loadInitialAdapter() {
  const saved = readSavedConfig();
  if (saved && saved.kind === 'postgres' && saved.url) {
    return createPostgresAdapter(saved.url);
  }
  if (saved && saved.kind === 'sheets' && saved.sheetId) {
    return createSheetsAdapter(saved.sheetId, saved.googleServiceAccountJson);
  }
  if (saved && saved.kind === 'file') {
    return createFileAdapter();
  }

  const envKind = (process.env.STORAGE || 'file').toLowerCase();
  if (envKind === 'postgres') {
    return createPostgresAdapter(process.env.DATABASE_URL || '');
  }
  if (envKind === 'sheets') {
    return createSheetsAdapter(process.env.SHEET_ID, process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  return createFileAdapter();
}

currentAdapter = loadInitialAdapter();

const store = {
  get kind() {
    return currentAdapter.kind;
  },
  async init() {
    return currentAdapter.init();
  },
  async test() {
    return currentAdapter.test();
  },
  async get(n) {
    return currentAdapter.get(n);
  },
  async set(n, v) {
    return currentAdapter.set(n, v);
  },

  async testConnection(kind, options = {}) {
    if (kind === 'postgres' || kind === 'db') {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: options.url,
        ssl: /localhost|127\.0\.0\.1/.test(options.url || '') ? false : { rejectUnauthorized: false }
      });
      try {
        await pool.query('select 1');
        return 'Connected successfully to PostgreSQL database.';
      } finally {
        await pool.end().catch(() => {});
      }
    } else if (kind === 'sheets') {
      const adapter = createSheetsAdapter(options.sheetId, options.googleServiceAccountJson);
      return await adapter.test();
    } else {
      const adapter = createFileAdapter();
      return await adapter.test();
    }
  },

  async configure(kind, options = {}, persist = true) {
    if (currentAdapter && currentAdapter.close) {
      await currentAdapter.close().catch(() => {});
    }
    if (kind === 'postgres' || kind === 'db') {
      currentAdapter = createPostgresAdapter(options.url);
      if (persist) saveConfig({ kind: 'postgres', url: options.url });
    } else if (kind === 'sheets') {
      currentAdapter = createSheetsAdapter(options.sheetId, options.googleServiceAccountJson);
      if (persist) {
        saveConfig({
          kind: 'sheets',
          sheetId: options.sheetId,
          googleServiceAccountJson: options.googleServiceAccountJson
        });
      }
    } else {
      currentAdapter = createFileAdapter();
      if (persist) saveConfig({ kind: 'file' });
    }
    await currentAdapter.init();
    return currentAdapter.kind;
  },

  saveConfig
};

module.exports = store;
