import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { loadRuntime } from '../apps/api/runtime.mjs';
import { createApplication } from '../apps/api/server.mjs';
import { openStore } from '../apps/api/store.mjs';
import { createService } from '../apps/api/service.mjs';
import { resetSyntheticData } from '../scripts/reset-test-data.mjs';

const env = { APP_MODE: 'sms-trial', HOST: '127.0.0.1', DATABASE_PATH: '/tmp/isolated-phone-trial.sqlite', PUBLIC_ORIGIN: 'https://trial.example', SMS_MODE: 'provider', SMS_PROVIDER: 'aliyun-pnvs', SMS_ACCESS_KEY_ID: 'test-id', SMS_ACCESS_KEY_SECRET: 'test-secret', SMS_SIGN_NAME: '测试签名', SMS_TEMPLATE_CODE: '100001', SMS_DAILY_LIMIT: '2' };
const key = () => randomUUID();

test('SMS trial rejects missing credentials, unbounded budgets, shared databases and insecure origins', () => {
  assert.equal(loadRuntime(env).mode, 'sms-trial');
  assert.equal(typeof loadRuntime(env).deliverCode.verifyCode, 'function');
  for (const bad of [{ HOST: '0.0.0.0' }, { DATABASE_PATH: ':memory:' }, { DATABASE_PATH: '/var/lib/payathon-test/test.sqlite' }, { DATABASE_PATH: 'var/development.sqlite' }, { SMS_DAILY_LIMIT: '' }, { SMS_DAILY_LIMIT: '21' }, { SMS_DAILY_LIMIT: '1.5' }, { SMS_ACCESS_KEY_SECRET: '' }, { SMS_MODE: 'development' }, { SMS_PROVIDER: 'aliyun' }, { PUBLIC_ORIGIN: 'http://trial.example' }]) assert.throws(() => loadRuntime({ ...env, ...bad }));
  assert.throws(() => loadRuntime({ ...env, APP_MODE: 'production' }), /not enabled/);
  assert.throws(() => createApplication({ mode: 'sms-trial', publicOrigin: env.PUBLIC_ORIGIN }), /remote verification/);
});

test('phone trial HTTP uses PNVS, secure cookie, persists identity, and rejects test codes or foreign origins', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sms-trial-http-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let calls = 0, app;
  const config = loadRuntime({ ...env, DATABASE_PATH: join(dir, 'phone.sqlite') }, { fetchImpl: async (url, options) => {
    calls++; const params = new URL(url).searchParams, sending = options.headers['x-acs-action'] === 'SendSmsVerifyCode';
    return { ok: true, status: 200, json: async () => ({ Code: 'OK', Success: true, Model: { OutId: params.get('OutId'), ...(sending ? { BizId: 'receipt' } : { VerifyResult: params.get('VerifyCode') === '234567' ? 'PASS' : 'UNKNOWN' }) } }) };
  } });
  app = createApplication(config);
  t.after(async () => { if (app) await app.close(); });
  async function start() { await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); }); }
  await start();
  function request(path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path: '/api/v1' + path, method: body === undefined ? 'GET' : 'POST', headers: { Host: 'trial.example', Origin: env.PUBLIC_ORIGIN, 'X-App-Request': '1', 'Content-Type': 'application/json', ...headers } }, res => {
        let raw = ''; res.on('data', chunk => { raw += chunk; }); res.on('end', () => resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0], body: JSON.parse(raw) }));
      }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const publicConfig = await request('/config');
  assert.equal(publicConfig.body.login, 'phone'); assert.equal(publicConfig.body.realSms, true); assert.equal(publicConfig.body.syntheticOnly, true);
  assert.ok(!JSON.stringify(publicConfig).includes('test-secret'));
  assert.equal((await request('/auth/test-login', { code: 'x'.repeat(24) })).status, 404);
  assert.equal((await request('/auth/code', { phone: '13900009001' }, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/config', undefined, { Host: 'attacker.example' })).status, 403); assert.equal(calls, 0);
  const sent = await request('/auth/code', { phone: '13900009001' });
  assert.equal(sent.status, 200); assert.equal(sent.body.developmentCode, undefined);
  const wrong = await request('/auth/login', { phone: '13900009001', code: '123456' });
  assert.equal(wrong.status, 401); assert.equal(wrong.cookie, undefined);
  const login = await request('/auth/login', { phone: '13900009001', code: '234567' });
  assert.equal(login.status, 200); assert.match(login.cookie, /HttpOnly; SameSite=Strict/); assert.match(login.cookie, /; Secure/);
  const userId = login.body.user.id, session = login.cookie.split(';')[0];
  assert.equal((await request('/me', undefined, { Cookie: session })).body.user.id, userId);
  await app.close(); app = createApplication(config); await start();
  assert.equal((await request('/me', undefined, { Cookie: session })).body.user.id, userId);
  assert.equal(app.store.get('SELECT count(*) n FROM users').n, 1);
});

test('global SMS budget persists across restarts and resets at Beijing midnight without network retries', async t => {
  const store = openStore(); t.after(() => store.close());
  let calls = 0, current = new Date('2026-10-15T15:59:00Z');
  const deliverCode = async () => { calls++; return { status: 'ACCEPTED' }; }; deliverCode.verifyCode = async () => ({ status: 'PASS' });
  const options = { smsMode: 'provider', deliverCode, smsDailyLimit: 2, clock: () => current };
  let api = createService(store, options);
  await api.requestCode({ phone: '13900009001' }, 'one'); await api.requestCode({ phone: '13900009002' }, 'two');
  api = createService(store, options);
  await assert.rejects(api.requestCode({ phone: '13900009003' }, 'three'), error => error.code === 'RATE_LIMITED'); assert.equal(calls, 2);
  current = new Date('2026-10-15T16:00:00Z');
  await api.requestCode({ phone: '13900009003' }, 'three'); assert.equal(calls, 3);
});

test('legacy reset clears accounts and related room data, revokes sessions and persists deletion tombstones', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'reset-legacy-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'legacy.sqlite'), store = openStore(path);
  const code = 'a'.repeat(24), api = createService(store, { testAccounts: [{ id: 'one', nickname: '示例', codeHash: createHash('sha256').update(code).digest('hex') }] });
  const login = api.testLogin({ code }, 'one'), user = api.authenticate(login.token);
  api.updateProfile(user, { nickname: '示例', adult: true, sensitiveConsent: true }, key());
  api.createRoom(user, { name: '旧小组', days: 14, intensity: '低', sharingConsent: true }, key());
  api.support(user, { message: '旧工单' }, key()); store.close();
  const report = resetSyntheticData(path); assert.equal(report.deletedAccounts, 1); assert.equal(report.deletionEvents, 1);
  assert.ok(Object.values(report.remaining).every(n => n === 0));
  const reopened = openStore(path); try { assert.throws(() => createService(reopened).authenticate(login.token), error => error.code === 'UNAUTHENTICATED'); } finally { reopened.close(); }
});

test('legacy reset refuses a database containing phone accounts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'reset-phone-refused-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'phone.sqlite'), store = openStore(path), api = createService(store);
  const sent = await api.requestCode({ phone: '13900009001' }, 'one'); api.login({ phone: '13900009001', code: sent.developmentCode }, 'one'); store.close();
  assert.throws(() => resetSyntheticData(path), /SYNTHETIC/);
  const reopened = openStore(path); try { assert.equal(reopened.get('SELECT count(*) n FROM users').n, 1); } finally { reopened.close(); }
});

test('trial backup CLI excludes both access credentials and obsolete test identity configuration', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'trial-backup-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, 'trial.sqlite'), store = openStore(databasePath); store.close();
  writeFileSync(join(dir, 'app.env'), 'SMS_ACCESS_KEY_SECRET=never-archive-this\n');
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/backup.mjs', 'create'], { encoding: 'utf8', env: { ...process.env, APP_MODE: 'sms-trial', DATABASE_PATH: databasePath, BACKUP_ROOT: join(dir, 'backups'), BACKUP_CONFIG_DIRECTORY: dir } }));
  const files = readdirSync(result.directory); assert.ok(!files.includes('app.env')); assert.ok(!files.includes('accounts.json'));
  const manifest = JSON.parse(readFileSync(join(result.directory, 'manifest.json'))); assert.equal(manifest.restore.ok, true);
  assert.ok(!JSON.stringify(manifest).includes('never-archive-this'));
});
