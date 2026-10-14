import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../apps/api/server.mjs';
async function setup(t) {
  const clock = { now: new Date('2026-10-13T03:00:00Z') }, app = createApplication({ clock: () => clock.now });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  t.after(() => app.close());
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  async function request(path, { method = 'GET', body, client, key = randomUUID(), headers = {} } = {}) {
    const result = await fetch(origin + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-App-Request': '1', Origin: origin, 'Idempotency-Key': key, ...(client ? { Cookie: client.cookie, 'X-CSRF-Token': client.csrf } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: result.status, headers: result.headers, data: await result.json() };
  }
  async function account(phone) {
    const otp = await request('/auth/code', { method: 'POST', body: { phone } }); assert.equal(otp.status, 200);
    const result = await request('/auth/login', { method: 'POST', body: { phone, code: otp.data.developmentCode } }); assert.equal(result.status, 200);
    const client = { cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.user.csrf, id: result.data.user.id };
    const profile = await request('/me', { method: 'PATCH', body: { nickname: phone.slice(-4), adult: true, sensitiveConsent: true }, client }); assert.equal(profile.status, 200);
    return client;
  }
  return { app, request, account, origin, clock };
}
test('HTTP UI assets → account → real room → record → second account sees same persisted data', async t => {
  const { request, account, origin } = await setup(t);
  const html = await fetch(origin); assert.equal(html.status, 200); assert.ok((await html.text()).includes('script type="module"')); assert.equal(html.headers.get('cache-control'), 'no-store');
  for (const path of ['/app.js', '/styles.css', '/packages/domain/index.mjs', '/packages/contracts/index.mjs']) assert.equal((await fetch(origin + path)).status, 200);
  const a = await account('13820000001'), b = await account('13820000002');
  const create = await request('/rooms', { method: 'POST', body: { name: '接口小组', intro: '', days: 14, intensity: '低', sharingConsent: true }, client: a }); assert.equal(create.status, 200);
  const id = create.data.roomId, base = '/rooms/' + id;
  let room = (await request(base, { client: a })).data;
  const invitation = await request('/invites/' + room.room.inviteCode); assert.equal(invitation.status, 200); assert.equal(invitation.data.invite.name, '接口小组'); assert.equal(invitation.data.invite.members, undefined);
  assert.equal((await request('/invites/' + room.room.inviteCode, { method: 'POST', client: b, body: { sharingConsent: true } })).status, 200);
  for (const client of [a, b]) { room = (await request(base, { client })).data; const prep = await request(base + '/preparation', { method: 'PUT', client, body: { height: 175, weight: 80, version: room.room.version } }); assert.equal(prep.status, 200); }
  const preview = (await request(base + '/start-preview', { client: a })).data;
  const body = { version: preview.version, date: preview.date, expiresAt: preview.expiresAt }, idem = randomUUID();
  const results = await Promise.all([1, 2].map(() => request(base + '/start', { method: 'POST', client: a, body, key: idem }))); assert.ok(results.every(r => r.status === 200));
  const recorded = await request(base + '/records', { method: 'PUT', client: a, body: { date: '2026-10-13', weight: 140, unit: 'jin', version: 0 } }); assert.equal(recorded.status, 200);
  const other = (await request(base, { client: b })).data; assert.equal(other.members.find(m => m.id === a.id).records[0].weight, 70); assert.ok(!JSON.stringify(other).includes('height'));
});
test('HTTP object authorization, CSRF, session revoke and private response headers', async t => {
  const { request, account } = await setup(t), a = await account('13830000001'), b = await account('13830000002');
  const body = { name: '', intro: '', days: 14, intensity: '低', sharingConsent: true };
  const created = await request('/rooms', { method: 'POST', body, client: a }), path = '/rooms/' + created.data.roomId;
  assert.equal((await request(path, { client: b })).status, 403); assert.equal((await request(path)).status, 401);
  assert.equal((await request('/rooms', { method: 'POST', body, client: b, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/rooms', { method: 'POST', body, client: b, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await request('/rooms', { method: 'POST', body, client: b, headers: { 'X-App-Request': '0' } })).status, 403);
  const me = await request('/me', { client: a }); assert.equal(me.headers.get('cache-control'), 'no-store'); assert.ok(me.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal((await request('/auth/logout', { method: 'POST', body: {}, client: a })).status, 200); assert.equal((await request(path, { client: a })).status, 401);
});
test('parallel create idempotency and unique active-room slot', async t => {
  const { request, account, app } = await setup(t), a = await account('13840000001');
  const body = { name: '', intro: '', days: 14, intensity: '低', sharingConsent: true }, key = randomUUID();
  const same = await Promise.all(Array.from({ length: 8 }, () => request('/rooms', { method: 'POST', body, client: a, key })));
  assert.ok(same.every(r => r.status === 200)); assert.equal(new Set(same.map(r => r.data.roomId)).size, 1); assert.equal(app.store.get('SELECT count(*) n FROM rooms').n, 1);
  const fresh = await Promise.all(Array.from({ length: 3 }, () => request('/rooms', { method: 'POST', body, client: a })));
  assert.ok(fresh.every(r => r.status === 409)); assert.equal(app.store.get('SELECT count(*) n FROM rooms').n, 1);
});
test('HTTP errors preserve machine code, business date and account deletion revokes cookies', async t => {
  const { request, account } = await setup(t), a = await account('13850000001');
  const bad = await request('/rooms', { method: 'POST', client: a, body: { name: '', days: 13, intensity: '低', sharingConsent: true } }); assert.equal(bad.status, 400); assert.equal(bad.data.error.code, 'VALIDATION'); assert.ok(bad.data.requestId);
  const deleted = await request('/me', { method: 'DELETE', client: a, body: { confirm: '注销并删除我的数据' } }); assert.equal(deleted.status, 200); assert.ok(deleted.headers.get('set-cookie').includes('Max-Age=0')); assert.equal((await request('/me', { client: a })).status, 401);
});
