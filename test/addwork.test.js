const test = require('node:test');
const assert = require('node:assert/strict');

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function createAddWork(holidays = []) {
  return function addWork(start, mins, e, sat, sun) {
    const c = new Date(start);
    const [sh, sm] = e.shiftStart.split(':').map(Number);
    const [eh, em] = e.shiftEnd.split(':').map(Number);
    const s0 = sh * 60 + sm;
    const e0 = eh * 60 + em;
    let ls = null, le = null;
    if (e.lunch) {
      const [a, b] = e.lunch.split(':').map(Number), x = a * 60 + b;
      if (x > s0 && x + 30 < e0) { ls = x; le = x + 30; }
    }
    let g = 0;
    while (mins > 0 && g++ < 5000) {
      const d = c.getDay();
      if ((d === 0 && !sun) || (d === 6 && !sat) || holidays.includes(iso(c))) {
        c.setDate(c.getDate() + 1);
        c.setHours(sh, sm, 0, 0);
        continue;
      }
      let m = c.getHours() * 60 + c.getMinutes();
      if (m < s0) { c.setHours(sh, sm, 0, 0); m = s0; }
      if (m >= e0) { c.setDate(c.getDate() + 1); c.setHours(sh, sm, 0, 0); continue; }
      if (ls !== null && m >= ls && m < le) { c.setHours(Math.floor(le / 60), le % 60, 0, 0); continue; }
      const nb = (ls !== null && m < ls) ? ls : e0, av = nb - m;
      if (av >= mins) { c.setMinutes(c.getMinutes() + mins); mins = 0; }
      else { c.setMinutes(c.getMinutes() + av); mins -= av; }
    }
    return c.getTime();
  };
}

test.describe('Working-time Engine (addWork)', () => {
  const defaultEmp = { shiftStart: '09:00', shiftEnd: '18:00', lunch: '13:00' };

  test('simple lead time within morning work hours', () => {
    const addWork = createAddWork([]);
    // Monday 2026-11-16 10:00:00
    const start = new Date(2026, 10, 16, 10, 0, 0).getTime();
    const end = addWork(start, 120, defaultEmp, false, false);
    const endDate = new Date(end);
    assert.equal(endDate.getHours(), 12);
    assert.equal(endDate.getMinutes(), 0);
    assert.equal(endDate.getDate(), 16);
  });

  test('lead time spanning across 30-min lunch break (13:00 - 13:30)', () => {
    const addWork = createAddWork([]);
    // Monday 2026-11-16 12:00:00 + 120 mins
    // 12:00 - 13:00 is 60 mins. Lunch is 13:00 - 13:30 (skipped).
    // Remaining 60 mins resume at 13:30 -> finish at 14:30.
    const start = new Date(2026, 10, 16, 12, 0, 0).getTime();
    const end = addWork(start, 120, defaultEmp, false, false);
    const endDate = new Date(end);
    assert.equal(endDate.getHours(), 14);
    assert.equal(endDate.getMinutes(), 30);
    assert.equal(endDate.getDate(), 16);
  });

  test('lead time spilling over to the next business day', () => {
    const addWork = createAddWork([]);
    // Monday 2026-11-16 17:00:00 (1 hour before 18:00 end) + 120 mins
    // 17:00 - 18:00 is 60 mins. Remaining 60 mins move to Tuesday 09:00 -> finish at 10:00.
    const start = new Date(2026, 10, 16, 17, 0, 0).getTime();
    const end = addWork(start, 120, defaultEmp, false, false);
    const endDate = new Date(end);
    assert.equal(endDate.getDate(), 17); // Tuesday
    assert.equal(endDate.getHours(), 10);
    assert.equal(endDate.getMinutes(), 0);
  });

  test('lead time spilling over the weekend (Friday afternoon to Monday)', () => {
    const addWork = createAddWork([]);
    // Friday 2026-11-20 17:00:00 + 120 mins
    // Sat & Sun not included -> resumes Monday 2026-11-23 at 09:00 -> ends at 10:00.
    const start = new Date(2026, 10, 20, 17, 0, 0).getTime();
    const end = addWork(start, 120, defaultEmp, false, false);
    const endDate = new Date(end);
    assert.equal(endDate.getDate(), 23); // Monday
    assert.equal(endDate.getDay(), 1);
    assert.equal(endDate.getHours(), 10);
  });

  test('including Saturday when sat=true', () => {
    const addWork = createAddWork([]);
    // Friday 2026-11-20 17:00:00 + 120 mins, sat=true, sun=false
    // Resumes Saturday 2026-11-21 at 09:00 -> ends at 10:00.
    const start = new Date(2026, 10, 20, 17, 0, 0).getTime();
    const end = addWork(start, 120, defaultEmp, true, false);
    const endDate = new Date(end);
    assert.equal(endDate.getDate(), 21); // Saturday
    assert.equal(endDate.getDay(), 6);
    assert.equal(endDate.getHours(), 10);
  });

  test('skipping designated holidays', () => {
    // Tuesday 2026-11-17 is a holiday
    const addWork = createAddWork(['2026-11-17']);
    // Monday 2026-11-16 17:00:00 + 120 mins
    // Monday uses 60 mins. Tuesday is holiday (skipped). Resumes Wednesday 2026-11-18 at 09:00 -> 10:00.
    const start = new Date(2026, 10, 16, 17, 0, 0).getTime();
    const end = addWork(start, 120, defaultEmp, false, false);
    const endDate = new Date(end);
    assert.equal(endDate.getDate(), 18); // Wednesday
    assert.equal(endDate.getHours(), 10);
  });

  test('task starting before shift hours is snapped to shift start', () => {
    const addWork = createAddWork([]);
    // Monday 2026-11-16 07:00 (before 09:00) + 60 mins -> ends at 10:00
    const start = new Date(2026, 10, 16, 7, 0, 0).getTime();
    const end = addWork(start, 60, defaultEmp, false, false);
    const endDate = new Date(end);
    assert.equal(endDate.getDate(), 16);
    assert.equal(endDate.getHours(), 10);
    assert.equal(endDate.getMinutes(), 0);
  });

  test('task starting after shift hours advances to next working day', () => {
    const addWork = createAddWork([]);
    // Monday 2026-11-16 20:00 (after 18:00) + 60 mins -> ends Tuesday 10:00
    const start = new Date(2026, 10, 16, 20, 0, 0).getTime();
    const end = addWork(start, 60, defaultEmp, false, false);
    const endDate = new Date(end);
    assert.equal(endDate.getDate(), 17);
    assert.equal(endDate.getHours(), 10);
    assert.equal(endDate.getMinutes(), 0);
  });

  test('employee with no lunch break specified', () => {
    const addWork = createAddWork([]);
    const empNoLunch = { shiftStart: '09:00', shiftEnd: '17:00', lunch: '' };
    // Monday 12:00 + 120 mins -> 14:00 (no lunch deducted)
    const start = new Date(2026, 10, 16, 12, 0, 0).getTime();
    const end = addWork(start, 120, empNoLunch, false, false);
    const endDate = new Date(end);
    assert.equal(endDate.getHours(), 14);
    assert.equal(endDate.getMinutes(), 0);
  });

  test('zero lead time returns start timestamp', () => {
    const addWork = createAddWork([]);
    const start = new Date(2026, 10, 16, 10, 0, 0).getTime();
    const end = addWork(start, 0, defaultEmp, false, false);
    assert.equal(end, start);
  });
});
