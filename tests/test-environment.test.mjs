import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createApplication } from '../apps/api/server.mjs';
import { loadRuntime } from '../apps/api/runtime.mjs';
const codes = [randomBytes(18).toString('base64url'), randomBytes(18).toString('base64url')];
const accounts = codes.map((code, i) => ({ id: 'tester-' + i, nickname: '测试成员' + i, codeHash: createHash('sha256').update(code).digest('hex') }));
const publicOrigin = 'https://test.example.com';
async function setup(t) {
  const app = createApplication({ mode: 'test', publicOrigin, testAccounts: accounts });
  await new Promise((yes, no) => { app.server.once('error', no); app.server.listen(0, '127.0.0.1', yes); });
  t.after(() => app.close());
  const local = 'http://127.0.0.1:' + app.server.address().port;
  async function request(path, { method = 'GET', body, client, headers } = {}) {
    return new Promise((yes, no) => {
      const req = http.request(local + '/api/v1' + path, { method, headers: { Host: 'test.example.com', Origin: publicOrigin, 'Content-Type': 'application/json', 'X-App-Request': '1', 'Idempotency-Key': randomUUID(), ...(client ? { Cookie: client.cookie, 'X-CSRF-Token': client.csrf } : {}), ...headers } }, res => {
        let raw = ''; res.on('data', chunk => { raw += chunk; }); res.on('end', () => yes({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0], data: JSON.parse(raw) }));
      });
      req.on('error', no); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async function login(code) { const r = await request('/auth/test-login', { method: 'POST', body: { code } }); assert.equal(r.status, 200); return { cookie: r.cookie.split(';')[0], csrf: r.data.user.csrf, id: r.data.user.id }; }
  return { app, local, request, login };
}
test('test runtime preserves local gates and requires isolated persistence, HTTPS and issued identities', t => {
  assert.throws(() => loadRuntime({ HOST: '0.0.0.0' }), /cannot be exposed/);
  assert.throws(() => loadRuntime({ NODE_ENV: 'production' }), /cannot be exposed/);
  assert.throws(() => loadRuntime({ APP_MODE: 'production' }), /not enabled/);
  assert.throws(() => loadRuntime({ APP_MODE: 'test', DATABASE_PATH: 'var/development.sqlite' }), /separate/);
  const dir = mkdtempSync(join(tmpdir(), 'cq-runtime-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'accounts.json'); writeFileSync(path, JSON.stringify(accounts));
  const env = { APP_MODE: 'test', DATABASE_PATH: join(dir, 'test.sqlite'), TEST_ACCOUNTS_PATH: path, PUBLIC_ORIGIN: publicOrigin, HOST: '0.0.0.0' };
  assert.equal(loadRuntime(env).mode, 'test');
  for (const origin of ['http://test.example.com', 'https://user:password@test.example.com', 'https://test.example.com/path']) assert.throws(() => loadRuntime({ ...env, PUBLIC_ORIGIN: origin }));
  writeFileSync(path, JSON.stringify([accounts[0], accounts[0]])); assert.throws(() => loadRuntime(env), /Invalid test account/);
});
test('public test config reveals no credentials; wrong host and phone OTP endpoints are rejected', async t => {
  const f = await setup(t), config = await f.request('/config');
  assert.equal(config.status, 200); assert.equal(config.data.login, 'test-code'); assert.equal(config.data.syntheticOnly, true);
  assert.ok(!JSON.stringify(config.data).includes(accounts[0].codeHash));
  assert.equal((await f.request('/config', { headers: { Host: 'attacker.example.com' } })).status, 403);
  assert.equal((await f.request('/auth/code', { method: 'POST', body: { phone: '13812345678' } })).data.error.code, 'TEST_LOGIN_ONLY');
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { phone: '13812345678', code: '123456' } })).status, 403);
  assert.equal(f.app.store.get('SELECT count(*) n FROM otp').n, 0);
  assert.equal((await fetch(f.local + '/api/v1/health')).status, 200);
});
test('issued codes create separate persistent identities and secure sessions, rejecting wrong code/origin', async t => {
  const f = await setup(t);
  assert.equal((await f.request('/auth/test-login', { method: 'POST', body: { code: 'x'.repeat(24) } })).status, 401);
  assert.equal((await f.request('/auth/test-login', { method: 'POST', body: { code: codes[0] }, headers: { Origin: 'https://attacker.example.com' } })).status, 403);
  const raw = await f.request('/auth/test-login', { method: 'POST', body: { code: codes[0] } }); assert.match(raw.cookie, /; Secure/); assert.match(raw.cookie, /HttpOnly/);
  const a = await f.login(codes[0]), again = await f.login(codes[0]), b = await f.login(codes[1]);
  assert.equal(a.id, again.id); assert.notEqual(a.id, b.id); assert.notEqual(a.cookie, again.cookie);
  assert.equal((await f.request('/me', { client: a })).data.user.phone, '测试身份');
  const logout = await f.request('/auth/logout', { method: 'POST', client: a, body: {} }); assert.match(logout.cookie, /Max-Age=0; Secure/);
  assert.equal((await f.request('/me', { client: a })).status, 401); assert.equal((await f.request('/me', { client: again })).status, 200);
});
