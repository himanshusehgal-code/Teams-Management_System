const express = require('express'), crypto = require('crypto'), path = require('path'), store = require('./store');
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set: everyone is signed out on each restart.');
const sign = u => { const p = Buffer.from(JSON.stringify({ n: u.name, x: Date.now() + 7 * 864e5 })).toString('base64url'); return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const verify = t => { try { const [p, s] = t.split('.'); if (!same(s, crypto.createHmac('sha256', SECRET).update(p).digest('base64url'))) return null; const d = JSON.parse(Buffer.from(p, 'base64url')); return d.x > Date.now() ? d.n : null; } catch { return null; } };
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const clean = ({ hash, salt, ...r }) => r;
const h = f => (q, r, n) => f(q, r, n).catch(e => { console.error(e); r.status(500).json({ error: 'Server error. Check the server logs.' }); });
const tries = new Map();
const limit = (q, r, n) => { const now = Date.now(), a = (tries.get(q.ip) || []).filter(t => now - t < 9e5); if (a.length >= 15) return r.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); a.push(now); tries.set(q.ip, a); n(); };

let cache = null;
async function getState() {
  if (cache && Date.now() - cache.t < 15000) return cache.s;
  const s = { ...((await store.get('meta')) || {}) };
  for (const n of ['employees', 'masters', 'tasks']) s[n] = (await store.get(n)) || [];
  cache = { s, t: Date.now() };
  return s;
}
async function persist(s) {
  const { employees, masters, tasks, ...meta } = s;
  await store.set('employees', employees); await store.set('masters', masters); await store.set('tasks', tasks); await store.set('meta', meta);
  cache = { s, t: Date.now() };
}
const isSetup = s => !!(s.setup && s.setup.done);
const canOf = u => t => u.role === 'Admin' || t.doer === u.name || t.validator === u.name || t.creator === u.name || (u.role === 'Manager' && t.team === u.team);
const auth = h(async (q, r, n) => {
  const name = verify((q.headers.authorization || '').slice(7));
  if (!name) return r.status(401).json({ error: 'Please sign in again.' });
  const s = await getState(), u = s.employees.find(e => e.name === name);
  if (!u) return r.status(401).json({ error: 'Account not found.' });
  q.s = s; q.u = u; n();
});
const find = (s, id) => s.employees.find(e => (e.email || '').toLowerCase() === id || e.mobile === id);

app.get('/healthz', (q, r) => r.send('ok'));
app.get('/api/status', h(async (q, r) => r.json({ setup: isSetup(await getState()), storage: store.kind })));

app.post('/api/setup/test', h(async (q, r) => {
  if (isSetup(await getState())) return r.status(403).json({ error: 'Setup is already complete.' });
  try { r.json({ ok: true, storage: store.kind, message: await store.test() }); }
  catch (e) { r.status(400).json({ error: e.message }); }
}));

app.post('/api/setup', h(async (q, r) => {
  if (isSetup(await getState())) return r.status(403).json({ error: 'Setup is already complete.' });
  const { size, backend, admin, team = [] } = q.body || {};
  if (!admin || !admin.name || !/^\S+@\S+\.\S+$/.test(admin.email || '') || String(admin.password || '').length < 8)
    return r.status(400).json({ error: 'Admin name, a valid email and a password of 8+ characters are required.' });
  await store.init();
  const mk = (e, role, pw) => {
    const o = { name: String(e.name).trim(), role, team: e.team || 'General', manager: e.manager || '', shiftStart: e.shiftStart || '09:00', shiftEnd: e.shiftEnd || '18:00', lunch: e.lunch || '', email: (e.email || '').toLowerCase(), mobile: e.mobile || '' };
    if (pw) { o.salt = crypto.randomBytes(16).toString('hex'); o.hash = hash(pw, o.salt); }
    return o;
  };
  const employees = [mk(admin, 'Admin', admin.password), ...team.filter(t => t && t.name && t.name !== admin.name).map(t => mk(t, t.role === 'Manager' ? 'Manager' : 'Member'))];
  await persist({ setup: { done: true, size, backend, at: Date.now() }, managerAccess: true, holidays: [], nextId: 1, nextM: 1, rev: 1, employees, masters: [], tasks: [] });
  r.json({ ok: true });
}));

app.post('/api/login', limit, h(async (q, r) => {
  const s = await getState(), u = find(s, String(q.body.id || '').trim().toLowerCase());
  if (!u) return r.status(401).json({ error: 'Not registered. Ask your admin to register you.' });
  if (!u.hash) return r.status(401).json({ error: 'First time here? Activate your account.', activate: true });
  if (!same(hash(String(q.body.password || ''), u.salt), u.hash)) return r.status(401).json({ error: 'Wrong password.' });
  r.json({ token: sign(u) });
}));

app.post('/api/activate', limit, h(async (q, r) => {
  const s = await getState(), u = find(s, String(q.body.id || '').trim().toLowerCase()), pw = String(q.body.password || '');
  if (!u) return r.status(401).json({ error: 'Not registered. Ask your admin to register you.' });
  if (u.hash) return r.status(400).json({ error: 'Already activated. Sign in instead.' });
  if (pw.length < 8) return r.status(400).json({ error: 'Use a password of at least 8 characters.' });
  u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(pw, u.salt);
  await persist({ ...s, rev: s.rev + 1 });
  r.json({ token: sign(u) });
}));

app.get('/api/state', auth, (q, r) => r.json({ ...q.s, employees: q.s.employees.map(clean), tasks: q.s.tasks.filter(canOf(q.u)), me: q.u.name }));

app.put('/api/state', auth, h(async (q, r) => {
  const b = q.body || {}, s = q.s, u = q.u, admin = u.role === 'Admin', mgr = u.role === 'Manager', can = canOf(u);
  if (b.rev !== s.rev) return r.status(409).json({ error: 'The data changed elsewhere.' });
  const vis = s.tasks.filter(can), visIds = new Set(vis.map(t => t.id)), rest = s.tasks.filter(t => !visIds.has(t.id));
  const inc = Array.isArray(b.tasks) ? b.tasks : [];
  for (const t of inc) if (!can(t) || rest.some(x => x.id === t.id)) return r.status(403).json({ error: 'You can’t change that task.' });
  if (!(admin || mgr) && vis.some(t => !inc.some(i => i.id === t.id))) return r.status(403).json({ error: 'You can’t delete tasks.' });
  const incM = Array.isArray(b.masters) ? b.masters : [];
  const masters = (admin || mgr) ? incM : [...s.masters, ...incM.filter(m => !s.masters.some(x => x.id === m.id) && m.doer === u.name)];
  let employees = s.employees;
  if (admin && Array.isArray(b.employees)) {
    employees = b.employees.filter(e => e && e.name).map(e => { const o = s.employees.find(x => x.name === e.name) || {}; const { hash: _h, salt: _s, ...c } = e; return { ...c, hash: o.hash, salt: o.salt }; });
    if (!employees.some(e => e.role === 'Admin')) return r.status(400).json({ error: 'Keep at least one Admin.' });
  }
  let tasks = [...rest, ...inc];
  const cutoff = Date.now() - 90 * 864e5, old = tasks.filter(t => t.done && t.done < cutoff);
  if (old.length) { await store.set('archive', [...((await store.get('archive')) || []), ...old]); tasks = tasks.filter(t => !old.includes(t)); }
  const maxId = Math.max(0, ...tasks.map(t => t.id), ...old.map(t => t.id));
  await persist({ ...s, employees, masters, tasks, rev: s.rev + 1,
    nextId: Math.max(s.nextId, b.nextId || 0, maxId + 1), nextM: Math.max(s.nextM, b.nextM || 0),
    managerAccess: admin && typeof b.managerAccess === 'boolean' ? b.managerAccess : s.managerAccess,
    holidays: admin && Array.isArray(b.holidays) ? b.holidays : s.holidays });
  r.json({ rev: s.rev + 1 });
}));

app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('Team Management running on port ' + (process.env.PORT || 3000) + ' using ' + store.kind + ' storage'));
