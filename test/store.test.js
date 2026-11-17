const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const testDir = path.join(__dirname, 'temp_store_data');
process.env.DATA_DIR = testDir;
process.env.STORAGE = 'file';

// Require store after setting environment
const store = require('../store');

test.describe('Store Adapter - File Mode', () => {
  test.beforeEach(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    await store.init();
  });

  test.after(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('store.kind reports file', () => {
    assert.equal(store.kind, 'file');
  });

  test('store.test() succeeds and creates dir', async () => {
    const res = await store.test();
    assert.match(res, /Using local file storage/i);
    assert.ok(fs.existsSync(testDir));
  });

  test('get non-existent key returns default null for meta, empty array for others', async () => {
    const meta = await store.get('meta');
    assert.equal(meta, null);

    const employees = await store.get('employees');
    assert.deepEqual(employees, []);

    const tasks = await store.get('tasks');
    assert.deepEqual(tasks, []);

    const archive = await store.get('archive');
    assert.deepEqual(archive, []);
  });

  test('set and get roundtrip for all key types', async () => {
    const metaObj = { setup: { done: true }, rev: 5 };
    await store.set('meta', metaObj);
    const readMeta = await store.get('meta');
    assert.deepEqual(readMeta, metaObj);

    const empList = [{ name: 'Alice', role: 'Admin' }];
    await store.set('employees', empList);
    const readEmp = await store.get('employees');
    assert.deepEqual(readEmp, empList);

    const taskList = [{ id: 1, title: 'Task 1' }, { id: 2, title: 'Task 2' }];
    await store.set('tasks', taskList);
    const readTasks = await store.get('tasks');
    assert.deepEqual(readTasks, taskList);

    const archiveList = [{ id: 99, title: 'Old Task' }];
    await store.set('archive', archiveList);
    const readArchive = await store.get('archive');
    assert.deepEqual(readArchive, archiveList);
  });
});
