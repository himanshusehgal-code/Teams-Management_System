const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3981;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const testDataDir = path.join(__dirname, 'temp_api_data');
const JWT_SECRET = 'super-secret-test-key-32-chars-long-12345';

let serverProcess;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(method, pathUrl, body = null, headers = {}) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${pathUrl}`, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

test.describe('TMS API Integration & RBAC Test Suite', () => {
  test.before(async () => {
    // Clean data dir
    fs.rmSync(testDataDir, { recursive: true, force: true });

    // Spawn server process
    const serverScript = path.join(__dirname, '..', 'server.js');
    serverProcess = spawn(process.execPath, [serverScript], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: testDataDir,
        STORAGE: 'file',
        JWT_SECRET
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', d => {
      console.log('[Server stdout]', d.toString());
    });
    serverProcess.stderr.on('data', d => {
      console.error('[Server stderr]', d.toString());
    });

    // Wait for server to start
    let started = false;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`${BASE_URL}/healthz`);
        if (r.ok) {
          started = true;
          break;
        }
      } catch {
        await sleep(150);
      }
    }
    if (!started) {
      throw new Error('Server failed to start on port ' + PORT);
    }
  });

  test.after(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  // 1. Health & Initial Status
  test('GET /healthz returns ok', async () => {
    const res = await request('GET', '/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.text, 'ok');
  });

  test('GET /api/status reports setup=false initially', async () => {
    const res = await request('GET', '/api/status');
    assert.equal(res.status, 200);
    assert.equal(res.json.setup, false);
    assert.equal(res.json.storage, 'file');
  });

  test('GET / serves public/index.html', async () => {
    const res = await request('GET', '/');
    assert.equal(res.status, 200);
    assert.match(res.text, /<!DOCTYPE html>/i);
    assert.match(res.text, /Team Management System/i);
  });

  // 2. Setup Flow & Validation
  test('POST /api/setup/test returns connection status', async () => {
    const res = await request('POST', '/api/setup/test');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.storage, 'file');
    assert.match(res.json.message, /Using local file storage/i);
  });

  test('POST /api/setup rejects invalid admin data', async () => {
    // Missing name
    let res = await request('POST', '/api/setup', {
      size: '1-10',
      backend: 'local',
      admin: { email: 'admin@test.com', password: 'password123' }
    });
    assert.equal(res.status, 400);

    // Invalid email
    res = await request('POST', '/api/setup', {
      size: '1-10',
      backend: 'local',
      admin: { name: 'Admin', email: 'invalid-email', password: 'password123' }
    });
    assert.equal(res.status, 400);

    // Password too short (< 8 chars)
    res = await request('POST', '/api/setup', {
      size: '1-10',
      backend: 'local',
      admin: { name: 'Admin', email: 'admin@test.com', password: 'short' }
    });
    assert.equal(res.status, 400);
  });

  let adminToken = '';
  let managerToken = '';
  let memberToken = '';

  test('POST /api/setup successfully initializes workspace', async () => {
    const res = await request('POST', '/api/setup', {
      size: '1-10',
      backend: 'local',
      admin: {
        name: 'Aarav Mehta',
        email: 'aarav@company.com',
        mobile: '9876543210',
        password: 'AdminPassword123'
      },
      team: [
        {
          name: 'Neha Sharma',
          role: 'Manager',
          team: 'Sales',
          email: 'neha@company.com',
          mobile: '9876543211'
        },
        {
          name: 'Rohit Verma',
          role: 'Member',
          team: 'Sales',
          email: 'rohit@company.com',
          mobile: '9876543212',
          manager: 'Neha Sharma'
        },
        {
          name: 'Priya Nair',
          role: 'Member',
          team: 'Operations',
          email: 'priya@company.com',
          mobile: '9876543213',
          manager: 'Aarav Mehta'
        }
      ]
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  test('POST /api/setup is blocked once setup is complete', async () => {
    const res = await request('POST', '/api/setup', {
      admin: { name: 'New Admin', email: 'new@admin.com', password: 'newpassword123' }
    });
    assert.equal(res.status, 403);
    assert.match(res.json.error, /Setup is already complete/i);
  });

  test('POST /api/setup/test is blocked once setup is complete', async () => {
    const res = await request('POST', '/api/setup/test');
    assert.equal(res.status, 403);
    assert.match(res.json.error, /Setup is already complete/i);
  });

  test('GET /api/status reports setup=true after setup', async () => {
    const res = await request('GET', '/api/status');
    assert.equal(res.status, 200);
    assert.equal(res.json.setup, true);
  });

  // 3. Authentication & Activation
  test('POST /api/login fails for unregistered identifier', async () => {
    const res = await request('POST', '/api/login', {
      id: 'unknown@company.com',
      password: 'password123'
    });
    assert.equal(res.status, 401);
    assert.match(res.json.error, /Not registered/i);
  });

  test('POST /api/login prompts activation for unactivated team member', async () => {
    const res = await request('POST', '/api/login', {
      id: 'neha@company.com',
      password: 'anyPassword'
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.activate, true);
    assert.match(res.json.error, /Activate your account/i);
  });

  test('POST /api/activate rejects short password', async () => {
    const res = await request('POST', '/api/activate', {
      id: 'neha@company.com',
      password: 'short'
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /8 characters/i);
  });

  test('POST /api/activate succeeds for registered member', async () => {
    const res = await request('POST', '/api/activate', {
      id: 'neha@company.com',
      password: 'ManagerPassword123'
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.token);
    managerToken = res.json.token;
  });

  test('POST /api/activate rejects subsequent activation attempt', async () => {
    const res = await request('POST', '/api/activate', {
      id: 'neha@company.com',
      password: 'AnotherPassword123'
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Already activated/i);
  });

  test('POST /api/login rejects wrong password', async () => {
    const res = await request('POST', '/api/login', {
      id: 'neha@company.com',
      password: 'IncorrectPassword'
    });
    assert.equal(res.status, 401);
    assert.match(res.json.error, /Wrong password/i);
  });

  test('POST /api/login succeeds for activated user with email', async () => {
    const res = await request('POST', '/api/login', {
      id: 'neha@company.com',
      password: 'ManagerPassword123'
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.token);
  });

  test('POST /api/login succeeds for activated user with mobile number', async () => {
    const res = await request('POST', '/api/login', {
      id: '9876543211',
      password: 'ManagerPassword123'
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.token);
  });

  test('POST /api/login succeeds for Admin', async () => {
    const res = await request('POST', '/api/login', {
      id: 'aarav@company.com',
      password: 'AdminPassword123'
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.token);
    adminToken = res.json.token;
  });

  test('Activate Rohit (Member)', async () => {
    const res = await request('POST', '/api/activate', {
      id: 'rohit@company.com',
      password: 'MemberPassword123'
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.token);
    memberToken = res.json.token;
  });

  // 4. State Retrieval (GET /api/state) & RBAC
  test('GET /api/state rejects unauthenticated request', async () => {
    const res = await request('GET', '/api/state');
    assert.equal(res.status, 401);
  });

  test('GET /api/state rejects forged or tampered token', async () => {
    const parts = adminToken.split('.');
    const tampered = parts[0] + '.invalidSignature';
    const res = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${tampered}`
    });
    assert.equal(res.status, 401);
  });

  test('GET /api/state strips password hash and salt from employees', async () => {
    const res = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.me, 'Aarav Mehta');
    assert.equal(Array.isArray(res.json.employees), true);
    for (const emp of res.json.employees) {
      assert.equal(emp.hash, undefined, 'Hash should not be exposed');
      assert.equal(emp.salt, undefined, 'Salt should not be exposed');
    }
  });

  // 5. State Mutation (PUT /api/state) & RBAC
  let currentRev = 1;

  test('PUT /api/state rejects mismatched revision (409 Conflict)', async () => {
    const res = await request(
      'PUT',
      '/api/state',
      { rev: 999, tasks: [] },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.equal(res.status, 409);
    assert.match(res.json.error, /data changed elsewhere/i);
  });

  test('Admin creates a task via PUT /api/state', async () => {
    const getRes = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${adminToken}`
    });
    currentRev = getRes.json.rev;

    const newTask = {
      id: 1,
      mid: 0,
      title: 'Prepare Sales Presentation',
      desc: 'Use Q4 template',
      type: 'One-Time',
      team: 'Sales',
      doer: 'Rohit Verma',
      validator: 'Neha Sharma',
      creator: 'Aarav Mehta',
      start: Date.now(),
      lead: 120,
      end: Date.now() + 4 * 3600000,
      status: 'Scope of Work',
      comments: []
    };

    const putRes = await request(
      'PUT',
      '/api/state',
      {
        rev: currentRev,
        tasks: [newTask],
        nextId: 2
      },
      { Authorization: `Bearer ${adminToken}` }
    );

    assert.equal(putRes.status, 200);
    currentRev = putRes.json.rev;
    assert.ok(currentRev > 1);
  });

  test('Member (Rohit) can see their assigned task and update status', async () => {
    const getRes = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${memberToken}`
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.json.me, 'Rohit Verma');
    assert.equal(getRes.json.tasks.length, 1);
    assert.equal(getRes.json.tasks[0].id, 1);

    const task = { ...getRes.json.tasks[0], status: 'Pending' };
    const putRes = await request(
      'PUT',
      '/api/state',
      {
        rev: getRes.json.rev,
        tasks: [task]
      },
      { Authorization: `Bearer ${memberToken}` }
    );

    assert.equal(putRes.status, 200);
    currentRev = putRes.json.rev;
  });

  test('Member (Rohit) is forbidden from deleting tasks (403)', async () => {
    const getRes = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${memberToken}`
    });
    // Rohit attempts to delete the task by submitting empty tasks array
    const putRes = await request(
      'PUT',
      '/api/state',
      {
        rev: getRes.json.rev,
        tasks: []
      },
      { Authorization: `Bearer ${memberToken}` }
    );
    assert.equal(putRes.status, 403);
    assert.match(putRes.json.error, /can’t delete tasks/i);
  });

  test('Member is forbidden from modifying tasks outside their access (403)', async () => {
    // Admin creates task 2 for Priya in Operations
    const getAdmin = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${adminToken}`
    });
    const opTask = {
      id: 2,
      mid: 0,
      title: 'Warehouse Audit',
      desc: '',
      type: 'One-Time',
      team: 'Operations',
      doer: 'Priya Nair',
      validator: 'Aarav Mehta',
      creator: 'Aarav Mehta',
      start: Date.now(),
      lead: 60,
      end: Date.now() + 3600000,
      status: 'Scope of Work',
      comments: []
    };
    const adminPut = await request(
      'PUT',
      '/api/state',
      {
        rev: getAdmin.json.rev,
        tasks: [...getAdmin.json.tasks, opTask],
        nextId: 3
      },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.equal(adminPut.status, 200);
    currentRev = adminPut.json.rev;

    // Rohit tries to submit state modifying task 2
    const rohitPut = await request(
      'PUT',
      '/api/state',
      {
        rev: currentRev,
        tasks: [{ ...opTask, title: 'Hijacked Task' }]
      },
      { Authorization: `Bearer ${memberToken}` }
    );
    assert.equal(rohitPut.status, 403);
    assert.match(rohitPut.json.error, /can’t change that task/i);
  });

  test('Manager (Neha) sees Sales tasks and can validate Rohit’s task', async () => {
    const getRes = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${managerToken}`
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.json.me, 'Neha Sharma');
    // Task 1 is Sales, Task 2 is Operations
    const salesTasks = getRes.json.tasks.filter(t => t.id === 1);
    assert.equal(salesTasks.length, 1);
    const opTasks = getRes.json.tasks.filter(t => t.id === 2);
    assert.equal(opTasks.length, 0, 'Manager of Sales should not see Operations tasks');

    // Neha approves task 1
    const updated = {
      ...salesTasks[0],
      status: 'Completed',
      done: Date.now()
    };
    const putRes = await request(
      'PUT',
      '/api/state',
      {
        rev: getRes.json.rev,
        tasks: [updated]
      },
      { Authorization: `Bearer ${managerToken}` }
    );
    assert.equal(putRes.status, 200);
    currentRev = putRes.json.rev;
  });

  test('Admin cannot remove all Admins from employees list (400)', async () => {
    const getRes = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${adminToken}`
    });
    // Demote Aarav Mehta to Member
    const demoted = getRes.json.employees.map(e => ({
      ...e,
      role: 'Member'
    }));
    const putRes = await request(
      'PUT',
      '/api/state',
      {
        rev: getRes.json.rev,
        employees: demoted
      },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.equal(putRes.status, 400);
    assert.match(putRes.json.error, /Keep at least one Admin/i);
  });

  // 6. Archival of Tasks Done > 90 Days Ago
  test('PUT /api/state archives tasks completed > 90 days ago', async () => {
    const getRes = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${adminToken}`
    });
    const oldDoneTime = Date.now() - 95 * 864e5; // 95 days ago
    const oldTask = {
      id: 99,
      mid: 0,
      title: 'Ancient Task from Q3',
      type: 'One-Time',
      team: 'Executive',
      doer: 'Aarav Mehta',
      validator: 'Aarav Mehta',
      creator: 'Aarav Mehta',
      start: oldDoneTime - 3600000,
      lead: 60,
      end: oldDoneTime,
      status: 'Completed',
      done: oldDoneTime,
      comments: []
    };

    const putRes = await request(
      'PUT',
      '/api/state',
      {
        rev: getRes.json.rev,
        tasks: [...getRes.json.tasks, oldTask]
      },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.equal(putRes.status, 200);

    // Verify state: task 99 should NOT be in active tasks
    const afterGet = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${adminToken}`
    });
    const foundInActive = afterGet.json.tasks.find(t => t.id === 99);
    assert.equal(foundInActive, undefined, 'Old task must be removed from active tasks');

    // Verify store file: archive.json should contain task 99
    const archiveFile = path.join(testDataDir, 'archive.json');
    assert.ok(fs.existsSync(archiveFile));
    const archiveData = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
    assert.ok(archiveData.some(t => t.id === 99), 'Old task must exist in archive');
  });
});
