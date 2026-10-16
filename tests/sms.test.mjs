import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { openStore } from '../apps/api/store.mjs';
import { createService } from '../apps/api/service.mjs';
import { createAliyunSms, loadSmsAdapter, SmsDeliveryError, inspectSmsConfiguration, aliyunAuthorization } from '../apps/api/sms.mjs';
const phone = '13900009001';
const rejected = code => error => error.code === code;
function setup(t, deliverCode, options = {}) {
  const store = openStore(), time = { value: new Date('2026-10-14T03:00:00Z') };
  const api = createService(store, { smsMode: 'provider', deliverCode, clock: () => time.value, ...options });
  t.after(() => store.close()); return { store, time, api };
}
test('pending OTP is unusable, simultaneous resend is throttled, accepted login restores identity', async t => {
  let input, complete;
  const f = setup(t, value => { input = value; return new Promise(resolve => { complete = resolve; }); });
  const pending = f.api.requestCode({ phone }, 'one');
  await Promise.resolve();
  assert.equal(f.store.get('SELECT delivery_state FROM otp').delivery_state, 'PENDING');
  assert.throws(() => f.api.login({ phone, code: input.code }, 'one'), rejected('INVALID_CODE'));
  await assert.rejects(f.api.requestCode({ phone }, 'two'), rejected('RATE_LIMITED'));
  complete({ status: 'ACCEPTED' }); const response = await pending;
  assert.equal(response.deliveryStatus, 'ACCEPTED');
  assert.equal(response.developmentCode, undefined);
  assert.ok(!JSON.stringify(response).includes(input.code));
  const first = f.api.login({ phone, code: input.code }, 'one');
  assert.throws(() => f.api.login({ phone, code: input.code }, 'one'), rejected('INVALID_CODE'));
  f.time.value = new Date(f.time.value.getTime() + 61000);
  const next = f.api.requestCode({ phone }, 'one'); await Promise.resolve(); complete({ status: 'ACCEPTED' }); await next;
  assert.equal(f.api.login({ phone, code: input.code }, 'one').user.id, first.user.id);
});
test('missing adapter creates no OTP; refusal/ambiguous responses cannot validate or expose provider errors', async t => {
  const absent = setup(t);
  await assert.rejects(absent.api.requestCode({ phone }, 'one'), rejected('SMS_UNAVAILABLE'));
  assert.equal(absent.store.get('SELECT count(*) n FROM otp').n, 0);
  for (const [result, expected] of [[{ status: 'FAILED' }, 'FAILED'], [undefined, 'UNKNOWN'], [new Error('secret raw response'), 'UNKNOWN']]) {
    let input;
    const f = setup(t, value => { input = value; if (result instanceof Error) throw result; return result; });
    await assert.rejects(f.api.requestCode({ phone }, 'one'), error => error.status === 503 && !error.message.includes('secret'));
    assert.equal(f.store.get('SELECT delivery_state FROM otp').delivery_state, expected);
    assert.throws(() => f.api.login({ phone, code: input.code }, 'one'), rejected('INVALID_CODE'));
    await assert.rejects(f.api.requestCode({ phone }, 'one'), rejected('RATE_LIMITED'));
  }
});
test('timeout aborts, late acceptance cannot resurrect old OTP or overwrite a newer dispatch', async t => {
  const inputs = [], completions = [];
  const f = setup(t, input => { inputs.push(input); return new Promise(resolve => completions.push(resolve)); }, { smsTimeoutMs: 20 });
  await assert.rejects(f.api.requestCode({ phone }, 'one'), rejected('SMS_DELIVERY_UNKNOWN'));
  assert.equal(inputs[0].signal.aborted, true);
  assert.equal(f.store.get('SELECT delivery_state FROM otp').delivery_state, 'UNKNOWN');
  f.time.value = new Date(f.time.value.getTime() + 61000);
  const retry = f.api.requestCode({ phone }, 'one'); await Promise.resolve();
  completions[0]({ status: 'ACCEPTED' }); completions[1]({ status: 'ACCEPTED' }); await retry;
  assert.equal(f.store.get('SELECT dispatch_id FROM otp').dispatch_id, inputs[1].dispatchId);
  assert.equal(f.store.get('SELECT delivery_state FROM otp').delivery_state, 'ACCEPTED');
  assert.equal(f.api.login({ phone, code: inputs[1].code }, 'one').user.phone, '139****9001');
});
test('restart converts abandoned pending dispatch to unknown, expiry removes all delivery states', async t => {
  const f = setup(t, () => ({ status: 'ACCEPTED' }), { smsTimeoutMs: 20 });
  await f.api.requestCode({ phone }, 'one');
  f.store.run("UPDATE otp SET delivery_state='PENDING'");
  f.time.value = new Date(f.time.value.getTime() + 21); f.api.expire();
  assert.equal(f.store.get('SELECT delivery_state FROM otp').delivery_state, 'UNKNOWN');
  f.time.value = new Date(f.time.value.getTime() + 300000); f.api.expire();
  assert.equal(f.store.get('SELECT count(*) n FROM otp').n, 0);
});

test('SMS cooldown rejection reports actual remaining seconds rather than always resetting to sixty', async t => {
  const f = setup(t, () => ({ status: 'ACCEPTED' }));
  await f.api.requestCode({ phone }, 'one');
  f.time.value = new Date(f.time.value.getTime() + 13500);
  await assert.rejects(f.api.requestCode({ phone }, 'one'), error => error.code === 'RATE_LIMITED' && error.details.retryAfter === 47 && error.message.includes('47'));
  f.time.value = new Date(f.time.value.getTime() + 46500);
  assert.equal((await f.api.requestCode({ phone }, 'one')).deliveryStatus, 'ACCEPTED');
});
const config = { accessKeyId: 'test-id', accessKeySecret: 'test-secret', signName: '测试签名', templateCode: 'SMS_123456' };
test('ACS3 authorization matches the official fixed-parameter signature example', () => {
  // https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
  const headers = { host: 'ecs.cn-shanghai.aliyuncs.com', 'x-acs-action': 'RunInstances', 'x-acs-version': '2014-05-26',
    'x-acs-date': '2023-10-26T10:22:32Z', 'x-acs-signature-nonce': '3156853299f313e23d1673dc12e1703d',
    'x-acs-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  const authorization = aliyunAuthorization('YourAccessKeyId', 'YourAccessKeySecret', headers, 'ImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai');
  assert.equal(authorization.split('Signature=')[1], '06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0');
});
test('offline SMS check reports actionable missing fields and never echoes supplied values', () => {
  const env = { SMS_PROVIDER: 'aliyun', SMS_ACCESS_KEY_ID: 'private-id', SMS_ACCESS_KEY_SECRET: 'private-secret', SMS_SIGN_NAME: '私有签名', SMS_TEMPLATE_CODE: 'SMS_123456' };
  const complete = inspectSmsConfiguration(env);
  assert.equal(complete.ok, true); assert.equal(complete.deliveryVerified, false);
  assert.equal(complete.networkUsed, false); assert.equal(complete.smsSent, false);
  const partial = inspectSmsConfiguration({ ...env, SMS_ACCESS_KEY_SECRET: '' });
  assert.deepEqual(partial.issues, [{ field: 'SMS_ACCESS_KEY_SECRET', code: 'MISSING', message: '尚未配置' }]);
  for (const report of [complete, partial, inspectSmsConfiguration({ SMS_PROVIDER: 'private-provider' })]) {
    assert.ok(!JSON.stringify(report).includes('private-')); assert.ok(!JSON.stringify(report).includes('私有签名'));
  }
  for (const [field, value] of [['SMS_ACCESS_KEY_ID', 'id\r\ninjected'], ['SMS_ACCESS_KEY_SECRET', ' secret '], ['SMS_TEMPLATE_CODE', 'not-a-template'], ['SMS_SECURITY_TOKEN', {}]]) {
    const invalid = { ...env, [field]: value };
    assert.equal(inspectSmsConfiguration(invalid).ok, false);
    assert.throws(() => loadSmsAdapter(invalid), /configuration/);
  }
});
test('offline SMS CLI exits clearly without network access or value disclosure', () => {
  const script = new URL('../scripts/sms-check.mjs', import.meta.url).pathname;
  const missing = spawnSync(process.execPath, [script], { env: {}, encoding: 'utf8' });
  assert.equal(missing.status, 1); assert.equal(missing.stderr, '');
  assert.equal(JSON.parse(missing.stdout).issues[0].field, 'SMS_PROVIDER');
  const env = { SMS_PROVIDER: 'aliyun', SMS_ACCESS_KEY_ID: 'private-id', SMS_ACCESS_KEY_SECRET: 'private-secret', SMS_SIGN_NAME: '私有签名', SMS_TEMPLATE_CODE: 'SMS_123456' };
  const report = JSON.parse(execFileSync(process.execPath, [script], { env, encoding: 'utf8' }));
  assert.equal(report.ok, true); assert.equal(report.deliveryVerified, false);
  assert.equal(report.smsSent, false); assert.ok(!JSON.stringify(report).includes('private-'));
});
test('Aliyun adapter validates config and signs fixed HTTPS requests; OK means accepted, never delivered', async () => {
  assert.throws(() => loadSmsAdapter({}), /SMS_PROVIDER/);
  assert.throws(() => createAliyunSms({ ...config, signName: '' }), /configuration/);
  let sent;
  const deliver = createAliyunSms(config, { fetchImpl: async (url, options) => { sent = { url, options }; return { ok: true, status: 200, json: async () => ({ Code: 'OK', BizId: 'receipt' }) }; } });
  assert.deepEqual(await deliver({ phone, code: '123456' }), { status: 'ACCEPTED' });
  assert.equal(new URL(sent.url).origin, 'https://dysmsapi.aliyuncs.com');
  assert.equal(new URL(sent.url).searchParams.get('TemplateParam'), '{"code":"123456"}');
  assert.equal(sent.options.redirect, 'error');
  assert.match(sent.options.headers.Authorization, /^ACS3-HMAC-SHA256 Credential=test-id,/);
  assert.ok(!sent.url.includes(config.accessKeySecret));
  for (const [body, status, outcome] of [[{ Code: 'isv.INVALID_PARAMETERS', Message: phone }, 400, 'FAILED'], [{ Code: 'OK' }, 200, 'UNKNOWN'], [{ Code: 'InternalError' }, 500, 'UNKNOWN']]) {
    const adapter = createAliyunSms(config, { fetchImpl: async () => ({ ok: status === 200, status, json: async () => body }) });
    await assert.rejects(adapter({ phone, code: '123456' }), error => error instanceof SmsDeliveryError && error.outcome === outcome && !error.message.includes(phone));
  }
});
test('v1 migration preserves accounts, invalidates legacy OTP, and never downgrades on reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cq-sms-migration-')), path = join(dir, 'old.sqlite'); let store;
  try {
    const db = new DatabaseSync(path); db.exec(readFileSync(new URL('../db/migrations/001-initial.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO users(id,phone,nickname,created_at) VALUES(?,?,?,?)').run('old-user', phone, '原账号', '2026-10-14');
    db.prepare('INSERT INTO otp VALUES(?,?,?,?,0)').run(phone, 'old-hash', Date.now() + 100000, Date.now()); db.close();
    store = openStore(path); assert.equal(store.get('SELECT nickname FROM users').nickname, '原账号');
    assert.equal(store.get('SELECT count(*) n FROM otp').n, 0); assert.equal(store.get('PRAGMA user_version').user_version, 3);
    store.close(); store = openStore(path); assert.equal(store.get('PRAGMA user_version').user_version, 3);
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});
