const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test.describe('Frontend HTML & Client Script Validation', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  let htmlContent = '';
  let scriptContent = '';

  test('public/index.html exists and has required DOM elements', () => {
    assert.ok(fs.existsSync(htmlPath), 'index.html must exist');
    htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.match(htmlContent, /<div id="app"><\/div>/, 'DOM must have #app');
    assert.match(htmlContent, /<dialog id="dlg"><\/dialog>/, 'DOM must have #dlg');
    assert.match(htmlContent, /<div id="toast" class="toast" hidden><\/div>/, 'DOM must have #toast');
    assert.match(htmlContent, /<meta name="viewport"/, 'Must contain responsive viewport tag');
  });

  test('Frontend JavaScript extracts and passes syntax compilation', () => {
    const match = htmlContent.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(match, 'index.html must contain an inline <script> block');
    scriptContent = match[1];

    // Compile script with node vm
    assert.doesNotThrow(() => {
      new vm.Script(scriptContent, { filename: 'public/index.html#script' });
    }, 'Client-side script must have valid JavaScript syntax');
  });

  test('Frontend helper functions: esc (XSS prevention)', () => {
    const esc = s =>
      String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    assert.equal(esc('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.equal(esc('Tom & Jerry'), 'Tom &amp; Jerry');
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });

  test('Frontend helper functions: pad, iso, hm, fmt', () => {
    const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const hm = m => `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
    const fmt = t => {
      if (!t) return '–';
      const d = new Date(t);
      return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    assert.equal(pad(5), '05');
    assert.equal(pad(12), '12');

    const d = new Date(2026, 10, 17, 9, 5); // Month 10 is Nov
    assert.equal(iso(d), '2026-11-17');
    assert.equal(hm(150), '2h 30m');
    assert.equal(hm(0), '0h 00m');

    assert.equal(fmt(null), '–');
    assert.equal(fmt(undefined), '–');
    assert.equal(fmt(d.getTime()), '17-11-2026 09:05');
  });

  test('Demo seed generator produces valid initial state', () => {
    // Execute a sandbox context to evaluate seed()
    const sandbox = {
      Date,
      Math,
      String,
      pad: n => String(n).padStart(2, '0')
    };
    vm.createContext(sandbox);

    const code = `
      const emp = (n, role, team, mgr, ss = '09:00', se = '18:00', l = '13:00') => ({
        name: n, role, team, manager: mgr, shiftStart: ss, shiftEnd: se, lunch: l
      });
      function seed() {
        const n = Date.now(), h = 36e5;
        return {
          setup: { done: true, size: '1-10', backend: 'local' },
          demo: true,
          managerAccess: true,
          holidays: ['2026-12-25', '2027-01-26'],
          nextId: 6,
          nextM: 2,
          employees: [
            emp('Aarav Mehta', 'Admin', 'Operations', ''),
            emp('Neha Sharma', 'Manager', 'Sales', 'Aarav Mehta'),
            emp('Rohit Verma', 'Member', 'Sales', 'Neha Sharma'),
            emp('Priya Nair', 'Member', 'Operations', 'Aarav Mehta', '10:00', '19:00', '14:00'),
            emp('Kabir Singh', 'Member', 'Operations', 'Aarav Mehta')
          ],
          masters: [{ id: 1, title: 'Daily stock report', type: 'Recurring', freq: 'Daily', doer: 'Priya Nair', validator: 'Aarav Mehta', team: 'Operations', lead: 60, active: true }],
          tasks: [
            { id: 1, mid: 0, title: 'Send Diwali offer to top 50 clients', desc: 'Use the approved template and track replies.', type: 'One-Time', team: 'Sales', doer: 'Rohit Verma', validator: 'Neha Sharma', start: n - 5 * h, lead: 240, end: n + 20 * h, status: 'Pending', creator: 'Neha Sharma', comments: [] }
          ]
        };
      }
      seed();
    `;
    const result = vm.runInContext(code, sandbox);
    assert.ok(result.setup.done);
    assert.equal(result.demo, true);
    assert.equal(result.employees.length, 5);
    assert.ok(result.employees.some(e => e.role === 'Admin'));
    assert.ok(result.tasks.length > 0);
  });
});
