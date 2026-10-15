import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openStore } from '../apps/api/store.mjs';
import { createService } from '../apps/api/service.mjs';
test('start confirmation expires across Beijing midnight, even with matching room version', async t => {
  const store = openStore(); t.after(() => store.close()); let now = new Date('2026-10-13T15:59:30Z'); const api = createService(store, { clock: () => now }); const users = [];
  for (const phone of ['13860000001', '13860000002']) { const otp = await api.requestCode({ phone }, phone); const login = api.login({ phone, code: otp.developmentCode }, phone); const user = api.authenticate(login.token); api.updateProfile(user, { nickname: '测试', adult: true, sensitiveConsent: true }, randomUUID()); users.push(user); }
  const roomId = api.createRoom(users[0], { name: '', intro: '', days: 28, intensity: '低', sharingConsent: true }, randomUUID()).roomId;
  const code = api.snapshot(users[0], roomId).room.inviteCode; api.joinRoom(users[1], code, { sharingConsent: true }, randomUUID());
  for (const user of users) api.prepare(user, roomId, { height: 175, weight: 80, version: api.snapshot(user, roomId).room.version }, randomUUID());
  const preview = api.startPreview(users[0], roomId); now = new Date('2026-10-13T16:00:00Z'); api.expire();
  assert.throws(() => api.startRoom(users[0], roomId, preview, randomUUID()), e => e.code === 'PREVIEW_STALE');
  const updated = api.startPreview(users[0], roomId); api.startRoom(users[0], roomId, updated, randomUUID()); assert.equal(api.snapshot(users[0], roomId).room.startDate, '2026-10-14');
});
test('ended period coverage remains full-period, personal 7-day analysis stays scoped', async t => {
  const store = openStore(); t.after(() => store.close()); let now = new Date('2026-10-01T03:00:00Z'); const api = createService(store, { clock: () => now }); const users = [];
  for (const phone of ['13870000001', '13870000002']) { const otp = await api.requestCode({ phone }, phone); const login = api.login({ phone, code: otp.developmentCode }, phone); const user = api.authenticate(login.token); api.updateProfile(user, { nickname: '测试', adult: true, sensitiveConsent: true }, randomUUID()); users.push(user); }
  const roomId = api.createRoom(users[0], { name: '', intro: '', days: 28, intensity: '低', sharingConsent: true }, randomUUID()).roomId;
  api.joinRoom(users[1], api.snapshot(users[0], roomId).room.inviteCode, { sharingConsent: true }, randomUUID());
  for (const user of users) api.prepare(user, roomId, { height: 175, weight: 80, version: api.snapshot(user, roomId).room.version }, randomUUID());
  api.startRoom(users[0], roomId, api.startPreview(users[0], roomId), randomUUID());
  for (const date of ['2026-10-01', '2026-10-28']) { now = new Date(date + 'T03:00:00Z'); api.saveRecord(users[0], roomId, { date, weight: 70, unit: 'kg', version: 0 }, randomUUID()); }
  now = new Date('2026-10-29T03:00:00Z'); api.expire();
  const s = api.snapshot(users[0], roomId, 7).members.find(m => m.id === users[0].id);
  assert.equal(s.summary.count, 1); assert.equal(s.summary.denominator, 7); assert.equal(s.periodSummary.count, 2); assert.equal(s.periodSummary.denominator, 28);
});
test('non-development SMS adapter never exposes a development code', async t => {
  const store = openStore(); t.after(() => store.close()); let sent;
  const api = createService(store, { smsMode: 'provider', deliverCode: async input => { sent = input; return { status: 'ACCEPTED' }; } });
  const result = await api.requestCode({ phone: '13880000001' }, 'test'); assert.equal(result.developmentCode, undefined); assert.equal(sent.phone, '13880000001');
  assert.ok(api.login({ phone: sent.phone, code: sent.code }, 'test').token);
});
