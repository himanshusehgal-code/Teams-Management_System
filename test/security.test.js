const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 3982;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const testDataDir = path.join(__dirname, 'temp_sec_data');
const JWT_SECRET = 'security-test-secret-32-chars-long-1234';

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
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${pathUrl}`, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

test.describe('TMS Security, Rate-Limiting & Cryptography Suite', () => {
  test.before(async () => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
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
    if (!started) throw new Error('Security test server failed to start');

    // Run setup
    await request('POST', '/api/setup', {
      size: '1-10',
      backend: 'local',
      admin: {
        name: 'Sec Admin',
        email: 'secadmin@company.com',
        password: 'Password1234'
      }
    });
  });

  test.after(() => {
    if (serverProcess) serverProcess.kill('SIGTERM');
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  test('Expired JWT token is rejected (401)', async () => {
    // Generate an expired token using the same algorithm
    const payload = Buffer.from(
      JSON.stringify({ n: 'Sec Admin', x: Date.now() - 1000 })
    ).toString('base64url');
    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(payload)
      .digest('base64url');
    const expiredToken = `${payload}.${signature}`;

    const res = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${expiredToken}`
    });
    assert.equal(res.status, 401);
    assert.match(res.json.error, /sign in again/i);
  });

  test('Token signed with wrong secret is rejected (401)', async () => {
    const payload = Buffer.from(
      JSON.stringify({ n: 'Sec Admin', x: Date.now() + 3600000 })
    ).toString('base64url');
    const signature = crypto
      .createHmac('sha256', 'wrong-secret-key-12345678901234')
      .update(payload)
      .digest('base64url');
    const bogusToken = `${payload}.${signature}`;

    const res = await request('GET', '/api/state', null, {
      Authorization: `Bearer ${bogusToken}`
    });
    assert.equal(res.status, 401);
  });

  test('Payload exceeding 2MB limit is rejected (413 Payload Too Large)', async () => {
    // Generate 2.5MB string
    const bigStr = 'x'.repeat(2.5 * 1024 * 1024);
    const res = await request('POST', '/api/login', { id: bigStr, password: 'pw' });
    assert.equal(res.status, 413);
  });

  test('Rate limiter blocks 16th attempt on /api/login (429 Too Many Attempts)', async () => {
    // Make 14 requests (we already did 0 before this test)
    for (let i = 0; i < 14; i++) {
      const res = await request('POST', '/api/login', {
        id: 'wrong@company.com',
        password: 'bad'
      });
      assert.equal(res.status, 401);
    }

    // 15th request succeeds in being processed (still 401)
    const res15 = await request('POST', '/api/login', {
      id: 'wrong@company.com',
      password: 'bad'
    });
    assert.equal(res15.status, 401);

    // 16th request MUST be rate limited with 429
    const res16 = await request('POST', '/api/login', {
      id: 'wrong@company.com',
      password: 'bad'
    });
    assert.equal(res16.status, 429);
    assert.match(res16.json.error, /Too many attempts/i);
  });
});
