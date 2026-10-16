import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../apps/api/server.mjs';
import http from 'node:http';
import { createRequester } from '../apps/web/request.mjs';
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
  for (const path of ['/app.js', '/request.mjs', '/styles.css', '/packages/domain/index.mjs', '/packages/contracts/index.mjs']) assert.equal((await fetch(origin + path)).status, 200);
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

const roomDraft = { name: '', intro: '', days: 14, intensity: '低', sharingConsent: true };
test('POST profile compatibility preserves authorization, consent and cross-method idempotency', async t => {
  const { request, account } = await setup(t), client = await account('13850000002');
  const body = { nickname: 'Eden', avatar: '🐱' }, key = randomUUID();
  assert.equal((await request('/me/profile', { method: 'POST', body })).status, 401);
  assert.equal((await request('/me/profile', { method: 'POST', body, client, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await request('/me/profile', { method: 'POST', body, client, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/me/profile', { method: 'POST', body, client, key })).status, 200);
  assert.equal((await request('/me', { method: 'PATCH', body, client, key })).status, 200);
  const me = (await request('/me', { client })).data.user;
  assert.equal(me.nickname, 'Eden'); assert.equal(me.avatar, '🐱'); assert.equal(me.consent, true);
  assert.equal((await request('/me/profile', { method: 'POST', body: { ...body, nickname: '' }, client })).status, 400);
  assert.equal((await request('/me/profile', { method: 'POST', body, client, key })).status, 200);
});
async function lobby(f, users) {
  const created = await f.request('/rooms', { method: 'POST', body: roomDraft, client: users[0] });
  assert.equal(created.status, 200);
  const base = '/rooms/' + created.data.roomId;
  const code = (await f.request(base, { client: users[0] })).data.room.inviteCode;
  for (const client of users.slice(1)) assert.equal((await f.request('/invites/' + code, { method: 'POST', client, body: { sharingConsent: true } })).status, 200);
  return { base, code };
}
async function active(f, users) {
  const result = await lobby(f, users);
  for (const client of users) {
    const version = (await f.request(result.base, { client })).data.room.version;
    assert.equal((await f.request(result.base + '/preparation', { method: 'PUT', client, body: { height: 175, weight: 80, version } })).status, 200);
  }
  const preview = (await f.request(result.base + '/start-preview', { client: users[0] })).data;
  assert.equal((await f.request(result.base + '/start', { method: 'POST', client: users[0], body: preview })).status, 200);
  return result;
}
test('two final-slot joins race: only one succeeds; loser can join after a slot frees', async t => {
  const f = await setup(t), users = [];
  for (let i = 1; i <= 9; i++) users.push(await f.account('1391000000' + i));
  const { base, code } = await lobby(f, users.slice(0, 7));
  const contenders = users.slice(7);
  const results = await Promise.all(contenders.map(client => f.request('/invites/' + code, { method: 'POST', client, body: { sharingConsent: true } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(results.find(r => r.status === 409).data.error.code, 'ROOM_FULL');
  assert.equal((await f.request(base, { client: users[0] })).data.members.length, 8);
  assert.equal((await f.request(base + '/leave', { method: 'POST', client: users[6], body: {} })).status, 200);
  const loser = contenders[results.findIndex(r => r.status === 409)];
  assert.equal((await f.request('/invites/' + code, { method: 'POST', client: loser, body: { sharingConsent: true } })).status, 200);
});
test('same account races to join two rooms: exactly one membership is created', async t => {
  const f = await setup(t), a = await f.account('13920000001'), b = await f.account('13920000002'), c = await f.account('13920000003');
  const rooms = [await lobby(f, [a]), await lobby(f, [b])];
  const results = await Promise.all(rooms.map(r => f.request('/invites/' + r.code, { method: 'POST', client: c, body: { sharingConsent: true } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(results.find(r => r.status === 409).data.error.code, 'ALREADY_IN_ROOM');
  assert.equal(f.app.store.get("SELECT count(*) n FROM members WHERE user_id=? AND state='JOINED'", c.id).n, 1);
});
test('two devices overwrite one record: conflict returns latest; reconfirmation succeeds', async t => {
  const f = await setup(t), a = await f.account('13930000001'), b = await f.account('13930000002'), { base } = await active(f, [a, b]);
  assert.equal((await f.request(base + '/records', { method: 'PUT', client: a, body: { date: '2026-10-13', weight: 70, unit: 'kg', version: 0 } })).status, 200);
  const updates = [69, 68].map(weight => ({ date: '2026-10-13', weight, unit: 'kg', version: 1, overwrite: true }));
  const results = await Promise.all(updates.map(body => f.request(base + '/records', { method: 'PUT', client: a, body })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const failed = results.findIndex(r => r.status === 409), latest = results[failed].data.error.details.latest;
  assert.equal(latest.version, 2); assert.equal(latest.weight, results[1 - failed].data.weight);
  assert.equal((await f.request(base + '/records', { method: 'PUT', client: a, body: { ...updates[failed], version: latest.version } })).status, 200);
  assert.equal(f.app.store.get('SELECT count(*) n FROM records').n, 1);
  assert.equal((await f.request(base, { client: b })).data.members.find(m => m.id === a.id).records[0].weight, updates[failed].weight);
});
test('lost committed response retries through HTTP without writing the record twice', async t => {
  const f = await setup(t), a = await f.account('13940000001'), b = await f.account('13940000002'), { base } = await active(f, [a, b]);
  let lose = true;
  const request = createRequester({ fetcher: async (path, options) => {
    const response = await fetch(f.origin + path, options);
    if (lose) { lose = false; assert.equal(response.status, 200); await response.json(); return { ok: true, status: 200, json: async () => { throw new Error('Response lost'); } }; }
    return response;
  } });
  const body = { date: '2026-10-13', weight: 70, unit: 'kg', version: 0 }, headers = { 'Content-Type': 'application/json', 'X-App-Request': '1', Origin: f.origin, Cookie: a.cookie, 'X-CSRF-Token': a.csrf };
  await assert.rejects(request(base + '/records', 'PUT', body, headers), e => e.code === 'NETWORK');
  assert.equal((await request(base + '/records', 'PUT', body, headers)).version, 1);
  assert.equal(f.app.store.get('SELECT version FROM records').version, 1);
  assert.equal(f.app.store.get('SELECT count(*) n FROM records').n, 1);
});
test('a request body spanning the exact period deadline cannot extend recording, even without the worker', async t => {
  const f = await setup(t), a = await f.account('13950000001'), b = await f.account('13950000002'), { base } = await active(f, [a, b]);
  // Keep the authenticated session alive beyond the period for this deadline test.
  f.app.store.run('UPDATE sessions SET expires_at=?', Date.parse('2026-11-01T00:00:00Z'));
  f.clock.now = new Date('2026-10-26T15:59:59Z');
  let reached; const beforeBody = new Promise(resolve => { reached = resolve; });
  const expire = f.app.service.expire;
  f.app.service.expire = () => { expire(); reached(); };
  let streamed;
  const response = new Promise((resolve, reject) => {
    streamed = http.request(f.origin + '/api/v1' + base + '/records', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-App-Request': '1', Origin: f.origin, Cookie: a.cookie, 'X-CSRF-Token': a.csrf, 'Idempotency-Key': randomUUID() } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    });
    streamed.on('error', reject); streamed.write('{"date":');
  });
  await beforeBody;
  assert.equal(f.app.store.get('SELECT status FROM rooms').status, 'ACTIVE');
  f.clock.now = new Date('2026-10-26T16:00:00Z');
  streamed.end('"2026-10-27","weight":70,"unit":"kg","version":0}');
  const result = await response;
  assert.equal(result.status, 409); assert.equal(result.data.error.code, 'ROOM_LOCKED');
  assert.equal(f.app.store.get('SELECT count(*) n FROM records').n, 0);
  assert.equal(f.app.store.get('SELECT status FROM rooms').status, 'ENDED');
});
for (const operation of ['preparation', 'edit', 'leave']) {
  test(`${operation} racing with start cannot lock stale goals or start with one member`, async t => {
    const f = await setup(t), a = await f.account('13970000001'), b = await f.account('13970000002'), { base } = await lobby(f, [a, b]);
    for (const client of [a, b]) {
      const version = (await f.request(base, { client })).data.room.version;
      assert.equal((await f.request(base + '/preparation', { method: 'PUT', client, body: { height: 175, weight: 80, version } })).status, 200);
    }
    const preview = (await f.request(base + '/start-preview', { client: a })).data;
    const competing = operation === 'preparation'
      ? { path: base + '/preparation', method: 'PUT', body: { height: 175, weight: 75, version: preview.version } }
      : operation === 'edit' ? { path: base, method: 'PATCH', body: { ...roomDraft, days: 56, version: preview.version } }
        : { path: base + '/leave', method: 'POST', body: {} };
    const results = await Promise.all([
      f.request(competing.path, { ...competing, client: a }),
      f.request(base + '/start', { method: 'POST', client: a, body: preview })
    ]);
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.ok(results.every(r => [200, 403, 409].includes(r.status)));
    const state = (await f.request(base, { client: b })).data;
    if (state.room.status === 'ACTIVE') { assert.equal(state.members.length, 2); assert.equal(state.room.days, 14); assert.ok(state.members.every(m => m.startWeight === 80)); }
    else if (operation === 'leave') { assert.equal(state.members.length, 1); assert.equal(state.room.ownerId, b.id); }
    else if (operation === 'edit') { assert.equal(state.room.days, 56); assert.ok(state.members.every(m => !m.ready && m.target === null)); }
    else assert.equal(state.members.find(m => m.id === a.id).startWeight, 75);
  });
}
test('different start requests race: only one transition succeeds; successful key replays safely', async t => {
  const f = await setup(t), a = await f.account('13980000001'), b = await f.account('13980000002'), { base } = await lobby(f, [a, b]);
  for (const client of [a, b]) {
    const version = (await f.request(base, { client })).data.room.version;
    await f.request(base + '/preparation', { method: 'PUT', client, body: { height: 175, weight: 80, version } });
  }
  const body = (await f.request(base + '/start-preview', { client: a })).data, keys = [randomUUID(), randomUUID()];
  const results = await Promise.all(keys.map(key => f.request(base + '/start', { method: 'POST', client: a, body, key })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const success = results.findIndex(r => r.status === 200);
  assert.equal((await f.request(base + '/start', { method: 'POST', client: a, body, key: keys[success] })).status, 200);
  const state = (await f.request(base, { client: a })).data;
  assert.equal(state.room.version, body.version + 1); assert.equal(state.room.startDate, '2026-10-13');
});
