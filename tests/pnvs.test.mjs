import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { openStore } from '../apps/api/store.mjs';
import { createService } from '../apps/api/service.mjs';
import { createApplication } from '../apps/api/server.mjs';
import { loadRuntime } from '../apps/api/runtime.mjs';
import { createAliyunPnvs, loadSmsAdapter, inspectSmsConfiguration, SmsDeliveryError } from '../apps/api/sms.mjs';

const phone = '13900009001', code = '234567';
const config = { accessKeyId: 'test-id', accessKeySecret: 'test-secret', signName: '测试签名', templateCode: '100001' };
const env = { SMS_PROVIDER: 'aliyun-pnvs', SMS_ACCESS_KEY_ID: config.accessKeyId, SMS_ACCESS_KEY_SECRET: config.accessKeySecret, SMS_SIGN_NAME: config.signName, SMS_TEMPLATE_CODE: config.templateCode };
const rejected = code => error => error.code === code;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = (Model, extras = {}) => ({ ok: true, status: 200, json: async () => ({ Code: 'OK', Success: true, Model, ...extras }) });
function fixture(t, verify = async () => ({ status: 'PASS' }), options = {}) {
  const sent = [], store = openStore(), time = { value: new Date('2026-10-15T03:00:00Z') };
  const deliverCode = async input => { sent.push(input); return { status: 'ACCEPTED' }; };
  deliverCode.verifyCode = verify;
  const api = createService(store, { smsMode: 'provider', deliverCode, clock: () => time.value, ...options });
  t.after(() => store.close());
  return { store, api, time, sent, deliverCode };
}

test('PNVS offline check accepts numeric template, rejects ordinary template and never reveals private config', () => {
  assert.equal(inspectSmsConfiguration(env).ok, true);
  const invalid = { ...env, SMS_TEMPLATE_CODE: 'SMS_123456' };
  assert.equal(inspectSmsConfiguration(invalid).ok, false);
  assert.throws(() => loadSmsAdapter(invalid), /configuration/);
  assert.equal(typeof loadSmsAdapter(env).verifyCode, 'function');
  const child = spawnSync(process.execPath, ['scripts/sms-check.mjs'], { env, encoding: 'utf8' });
  assert.equal(child.status, 0); assert.equal(child.stderr, '');
  const report = JSON.parse(child.stdout);
  assert.equal(report.networkUsed, false); assert.equal(report.smsSent, false); assert.equal(report.deliveryVerified, false);
  for (const value of Object.values(config)) assert.ok(!child.stdout.includes(value));
  assert.throws(() => loadRuntime({ ...env, SMS_MODE: 'provider' }), /Local mode/);
  assert.throws(() => loadRuntime({ ...env, APP_MODE: 'production' }), /not enabled/);
});

test('PNVS signs fixed endpoint requests, asks for a platform-generated six digit OTP and verifies remotely', async () => {
  const requests = [], dispatchId = 'test-dispatch';
  const deliver = createAliyunPnvs({ ...config, securityToken: 'test-token' }, { fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return response(options.headers['x-acs-action'] === 'SendSmsVerifyCode' ? { BizId: 'receipt', OutId: dispatchId, VerifyCode: 'must-not-escape' } : { VerifyResult: 'PASS', OutId: dispatchId });
  } });
  assert.deepEqual(await deliver({ phone, dispatchId }), { status: 'ACCEPTED' });
  const sent = requests[0], params = new URL(sent.url).searchParams;
  assert.equal(new URL(sent.url).origin, 'https://dypnsapi.aliyuncs.com');
  assert.equal(params.get('PhoneNumber'), phone); assert.equal(params.get('TemplateCode'), '100001');
  assert.equal(params.get('TemplateParam'), '{"code":"##code##","min":"5"}');
  for (const [key, value] of Object.entries({ CodeType: '1', CodeLength: '6', ValidTime: '300', Interval: '60', ReturnVerifyCode: 'false', AutoRetry: '0', DuplicatePolicy: '1', OutId: dispatchId })) assert.equal(params.get(key), value);
  assert.equal(sent.options.redirect, 'error'); assert.equal(sent.options.headers['x-acs-security-token'], 'test-token');
  assert.match(sent.options.headers.Authorization, /^ACS3-HMAC-SHA256 Credential=test-id,/);
  assert.ok(!sent.url.includes(config.accessKeySecret));
  assert.deepEqual(await deliver.verifyCode({ phone, code, dispatchId }), { status: 'PASS' });
  assert.equal(requests[1].options.headers['x-acs-action'], 'CheckSmsVerifyCode');
  assert.equal(new URL(requests[1].url).searchParams.get('VerifyCode'), code);
});

test('PNVS treats only a matching successful PASS as verified and redacts every provider failure', async () => {
  const dispatchId = 'check-id';
  const invalid = createAliyunPnvs(config, { fetchImpl: async () => response({ OutId: dispatchId, VerifyResult: 'UNKNOWN' }) });
  assert.deepEqual(await invalid.verifyCode({ phone, code, dispatchId }), { status: 'INVALID' });
  for (const makeResponse of [
    () => response({ OutId: dispatchId, VerifyResult: 'PASS' }, { Success: false }),
    () => response({ OutId: 'other-id', VerifyResult: 'PASS' }),
    () => response({ OutId: dispatchId }),
    () => ({ ok: false, status: 403, json: async () => ({ Code: 'Forbidden', Message: phone + config.accessKeySecret }) }),
    () => ({ ok: false, status: 500, json: async () => ({ Code: 'InternalError' }) }),
    () => { throw new Error(phone + config.accessKeySecret); }
  ]) {
    const adapter = createAliyunPnvs(config, { fetchImpl: async () => makeResponse() });
    await assert.rejects(adapter.verifyCode({ phone, code, dispatchId }), error => error instanceof SmsDeliveryError && !error.message.includes(phone) && !error.message.includes(config.accessKeySecret));
    await assert.rejects(adapter({ phone, dispatchId }), error => error instanceof SmsDeliveryError);
  }
});

test('PNVS flow stores no OTP hash, consumes once, and restores the same account after re-login', async t => {
  const checks = [], f = fixture(t, async input => { checks.push(input); return { status: 'PASS' }; });
  const sent = await f.api.requestCode({ phone }, 'one');
  assert.equal(sent.developmentCode, undefined); assert.equal(f.sent[0].code, undefined);
  assert.equal(f.store.get('SELECT code_hash FROM otp').code_hash, 'pnvs:' + f.sent[0].dispatchId);
  const first = await f.api.login({ phone, code }, 'one');
  assert.equal(checks[0].dispatchId, f.sent[0].dispatchId); assert.equal(checks[0].code, code);
  assert.throws(() => f.api.login({ phone, code }, 'one'), rejected('INVALID_CODE'));
  f.time.value = new Date(f.time.value.getTime() + 61000);
  await f.api.requestCode({ phone }, 'one');
  assert.equal((await f.api.login({ phone, code }, 'one')).user.id, first.user.id);
  assert.equal(f.store.get('SELECT count(*) n FROM sessions').n, 2);
});

test('wrong platform codes stop after five attempts without creating accounts or sessions', async t => {
  let count = 0; const f = fixture(t, async () => { count++; return { status: 'INVALID' }; });
  await f.api.requestCode({ phone }, 'one');
  for (let i = 0; i < 5; i++) await assert.rejects(f.api.login({ phone, code }, 'one'), rejected('INVALID_CODE'));
  assert.throws(() => f.api.login({ phone, code }, 'one'), rejected('INVALID_CODE'));
  assert.equal(count, 5); assert.equal(f.store.get('SELECT count(*) n FROM users').n, 0); assert.equal(f.store.get('SELECT count(*) n FROM sessions').n, 0);
});

test('concurrent checks and resend during a check cannot consume or replace the active OTP', async t => {
  const done = deferred(), started = deferred(), f = fixture(t, input => { started.resolve(input); return done.promise; });
  await f.api.requestCode({ phone }, 'one');
  const login = f.api.login({ phone, code }, 'one'); await started.promise;
  await assert.rejects(f.api.login({ phone, code }, 'two'), rejected('AUTH_IN_PROGRESS'));
  f.time.value = new Date(f.time.value.getTime() + 61000);
  await assert.rejects(f.api.requestCode({ phone }, 'two'), rejected('AUTH_IN_PROGRESS'));
  assert.equal(f.store.get('SELECT attempts FROM otp').attempts, 1);
  done.resolve({ status: 'PASS' }); await login;
  assert.equal(f.store.get('SELECT count(*) n FROM sessions').n, 1);
});

test('timed-out remote check aborts, invalidates OTP and ignores late PASS after a new send', async t => {
  const done = deferred(), started = deferred(), f = fixture(t, input => { started.resolve(input); return done.promise; }, { smsTimeoutMs: 20 });
  await f.api.requestCode({ phone }, 'one');
  const login = f.api.login({ phone, code }, 'one'), input = await started.promise;
  await assert.rejects(login, rejected('SMS_VERIFICATION_UNAVAILABLE'));
  assert.equal(input.signal.aborted, true); assert.equal(f.store.get('SELECT delivery_state FROM otp').delivery_state, 'UNKNOWN');
  assert.throws(() => f.api.login({ phone, code }, 'one'), rejected('INVALID_CODE'));
  f.time.value = new Date(f.time.value.getTime() + 61000); await f.api.requestCode({ phone }, 'one');
  done.resolve({ status: 'PASS' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.get('SELECT dispatch_id FROM otp').dispatch_id, f.sent[1].dispatchId);
  assert.equal(f.store.get('SELECT count(*) n FROM sessions').n, 0);
});

test('provider errors never create a session or fall back to local OTP matching', async t => {
  for (const result of [undefined, { status: 'ACCEPTED' }, new Error('sensitive provider text')]) {
    const f = fixture(t, async () => { if (result instanceof Error) throw result; return result; });
    await f.api.requestCode({ phone }, 'one');
    await assert.rejects(f.api.login({ phone, code }, 'one'), error => error.code === 'SMS_VERIFICATION_UNAVAILABLE' && !error.message.includes('sensitive'));
    assert.equal(f.store.get('SELECT count(*) n FROM users').n, 0);
    assert.equal(f.store.get('SELECT count(*) n FROM sessions').n, 0);
  }
});

test('PASS after expiry or replacement never issues a session', async t => {
  for (const change of ['expire', 'replace', 'delete']) {
    const done = deferred(), started = deferred(), f = fixture(t, () => { started.resolve(); return done.promise; });
    await f.api.requestCode({ phone }, 'one');
    const login = f.api.login({ phone, code }, 'one'); await started.promise;
    if (change === 'expire') f.time.value = new Date(f.time.value.getTime() + 300001);
    if (change === 'replace') f.store.run('UPDATE otp SET dispatch_id=?', 'replacement');
    if (change === 'delete') f.store.run('DELETE FROM otp');
    done.resolve({ status: 'PASS' }); await assert.rejects(login, rejected('INVALID_CODE'));
    assert.equal(f.store.get('SELECT count(*) n FROM sessions').n, 0);
  }
});

test('remote OTP marker survives service recreation and missing adapter cannot downgrade it', async t => {
  const f = fixture(t); await f.api.requestCode({ phone }, 'one');
  const missing = createService(f.store, { smsMode: 'provider', clock: () => f.time.value });
  await assert.rejects(missing.login({ phone, code }, 'one'), rejected('SMS_UNAVAILABLE'));
  const reloaded = createService(f.store, { smsMode: 'provider', deliverCode: f.deliverCode, clock: () => f.time.value });
  assert.equal((await reloaded.login({ phone, code }, 'one')).user.phone, '139****9001');
});

test('switching adapters cannot authenticate old local development or ordinary SMS credentials as PNVS', async t => {
  const f = fixture(t), dev = createService(f.store, { clock: () => f.time.value });
  const old = await dev.requestCode({ phone }, 'one');
  assert.throws(() => f.api.login({ phone, code: old.developmentCode }, 'one'), rejected('INVALID_CODE'));
  f.store.run("UPDATE otp SET delivery_state='ACCEPTED'");
  assert.throws(() => f.api.login({ phone, code: old.developmentCode }, 'one'), rejected('INVALID_CODE'));
  assert.equal(f.store.get('SELECT count(*) n FROM sessions').n, 0);
});

test('HTTP waits for PNVS verification before returning cookie, while synthetic test mode forbids phone login', async t => {
  const done = deferred(), started = deferred();
  const deliverCode = loadSmsAdapter(env, { fetchImpl: async (url, options) => {
    const OutId = new URL(url).searchParams.get('OutId');
    if (options.headers['x-acs-action'] === 'SendSmsVerifyCode') return response({ BizId: 'receipt', OutId });
    started.resolve(); await done.promise; return response({ VerifyResult: 'PASS', OutId });
  } });
  const app = createApplication({ smsMode: 'provider', deliverCode });
  t.after(() => app.close());
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (path, body) => fetch(base + '/api/v1/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Request': '1' }, body: JSON.stringify(body) });
  const sent = await post('code', { phone }); assert.equal(sent.status, 200);
  let finished = false; const login = post('login', { phone, code }).then(result => { finished = true; return result; });
  await started.promise; assert.equal(finished, false); assert.equal(app.store.get('SELECT count(*) n FROM sessions').n, 0);
  done.resolve({ status: 'PASS' }); const result = await login;
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await result.json()).user.phone, '139****9001');
  const sessionCookie = result.headers.get('set-cookie').split(';')[0];
  const me = await fetch(base + '/api/v1/me', { headers: { Cookie: sessionCookie } }); assert.equal(me.status, 200);
  const reused = await post('login', { phone, code }); assert.equal(reused.status, 401); assert.equal(reused.headers.get('set-cookie'), null);
  const testApp = createApplication({ mode: 'test', publicOrigin: 'https://test.example', testAccounts: [1, 2].map(i => ({ id: 'test-' + i, nickname: '朋友' + i, codeHash: createHash('sha256').update('test-code-' + i).digest('hex') })), deliverCode });
  t.after(() => testApp.close());
  await new Promise((resolve, reject) => { testApp.server.once('error', reject); testApp.server.listen(0, '127.0.0.1', resolve); });
  for (const route of ['code', 'login']) {
    const denied = await new Promise((resolve, reject) => {
      const request = http.request('http://127.0.0.1:' + testApp.server.address().port + '/api/v1/auth/' + route, { method: 'POST', headers: { Host: 'test.example', 'X-App-Request': '1', 'Content-Type': 'application/json' } }, res => {
        let raw = ''; res.on('data', chunk => { raw += chunk; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(raw) }));
      });
      request.on('error', reject); request.end(JSON.stringify({ phone, code }));
    });
    assert.equal(denied.status, 403); assert.equal(denied.data.error.code, 'TEST_LOGIN_ONLY');
  }
});
