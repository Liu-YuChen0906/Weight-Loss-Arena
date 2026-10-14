import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../apps/api/store.mjs';
import { createService } from '../apps/api/service.mjs';
const key = () => randomUUID();
const draft = (days = 28) => ({ name: '', intro: '', days, intensity: '中', sharingConsent: true });
function fixture(t) {
  const store = openStore(), clock = { date: new Date('2026-10-01T03:00:00Z') };
  const api = createService(store, { clock: () => clock.date });
  t.after(() => store.close()); let serial = 0;
  async function account(agreed = true) {
    const phone = '1390000' + String(++serial).padStart(4, '0'), otp = await api.requestCode({ phone }, phone);
    const login = api.login({ phone, code: otp.developmentCode }, phone), user = api.authenticate(login.token);
    if (agreed) api.updateProfile(user, { nickname: '测试' + serial, adult: true, sensitiveConsent: true }, key());
    return { user: api.authenticate(login.token), token: login.token, phone };
  }
  function tick(date) { clock.date = new Date(date + 'T03:00:00Z'); api.expire(); }
  function prepare(user, id, weight = 80) { const version = api.snapshot(user, id).room.version; return api.prepare(user, id, { height: 175, weight, version }, key()); }
  async function active(days = 28) { const a = await account(), b = await account(); const id = api.createRoom(a.user, draft(days), key()).roomId; const code = api.snapshot(a.user, id).room.inviteCode; api.joinRoom(b.user, code, { sharingConsent: true }, key()); prepare(a.user, id); prepare(b.user, id, 70); const preview = api.startPreview(a.user, id); api.startRoom(a.user, id, preview, key()); return { a, b, id, code }; }
  return { store, api, account, tick, prepare, active, clock };
}
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);
test('OTP one-time use, attempt cap, cooldown and sessions', async t => {
  const f = fixture(t), a = await f.account();
  assert.equal(f.api.authenticate(a.token).id, a.user.id);
  rejects(() => f.api.login({ phone: a.phone, code: '123456' }, a.phone), 'INVALID_CODE');
  const phone = '13811112222', otp = await f.api.requestCode({ phone }, phone);
  await assert.rejects(f.api.requestCode({ phone }, phone), e => e.code === 'RATE_LIMITED');
  const wrong = otp.developmentCode === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) rejects(() => f.api.login({ phone, code: wrong }, phone), 'INVALID_CODE');
  rejects(() => f.api.login({ phone, code: otp.developmentCode }, phone), 'INVALID_CODE');
  f.api.logout(a.token); rejects(() => f.api.authenticate(a.token), 'UNAUTHENTICATED');
});
test('consent server checks and idempotent room creation', async t => {
  const f = fixture(t), a = await f.account(false);
  rejects(() => f.api.createRoom(a.user, draft(), key()), 'CONSENT_REQUIRED');
  rejects(() => f.api.updateProfile(a.user, { nickname: '甲', adult: false, sensitiveConsent: true }, key()), 'CONSENT_REQUIRED');
  f.api.updateProfile(a.user, { nickname: '甲', adult: true, sensitiveConsent: true }, key());
  const idem = key(), result = f.api.createRoom(a.user, draft(), idem);
  assert.deepEqual(f.api.createRoom(a.user, draft(), idem), result);
  rejects(() => f.api.createRoom(a.user, draft(14), idem), 'IDEMPOTENCY_CONFLICT');
  rejects(() => f.api.createRoom(a.user, draft(), key()), 'ALREADY_IN_ROOM');
  assert.equal(f.api.snapshot(a.user, result.roomId).room.days, 28);
});
test('two accounts share records; outsiders and former members cannot read or replay', async t => {
  const f = fixture(t), { a, b, id, code } = await f.active(), outsider = await f.account();
  rejects(() => f.api.snapshot(outsider.user, id), 'FORBIDDEN');
  const invite = f.api.getInvite(code, 'one'); assert.equal(JSON.stringify(invite).includes('target'), false);
  const s = f.api.snapshot(b.user, id); assert.equal(s.members.length, 2); assert.equal(JSON.stringify(s).includes('height'), false);
  rejects(() => f.api.prepare(a.user, id, { height: 180, weight: 90, version: s.room.version }, key()), 'ROOM_LOCKED');
  rejects(() => f.api.leaveRoom(b.user, id, {}, key()), 'ROOM_LOCKED');
});
test('period edit preserves private inputs, clears preparation, start preview invalidates', async t => {
  const f = fixture(t), a = await f.account(), b = await f.account(), id = f.api.createRoom(a.user, draft(), key()).roomId;
  f.api.joinRoom(b.user, f.api.snapshot(a.user, id).room.inviteCode, { sharingConsent: true }, key()); f.prepare(a.user, id); f.prepare(b.user, id);
  const preview = f.api.startPreview(a.user, id);
  f.api.editRoom(a.user, id, { ...draft(56), version: preview.version }, key());
  assert.ok(f.api.snapshot(a.user, id).members.every(m => !m.ready && m.target === null));
  assert.equal(f.api.preparation(a.user, id).height, 175);
  rejects(() => f.api.startRoom(a.user, id, preview, key()), 'NOT_READY');
  f.prepare(a.user, id); f.prepare(b.user, id);
  rejects(() => f.api.startRoom(a.user, id, preview, key()), 'PREVIEW_STALE');
  const p = f.api.startPreview(a.user, id), idem = key(); assert.deepEqual(f.api.startRoom(a.user, id, p, idem), f.api.startRoom(a.user, id, p, idem));
});
test('creator leave transfers authority, rejoin resets readiness, empty group closes', async t => {
  const f = fixture(t), a = await f.account(), b = await f.account(), id = f.api.createRoom(a.user, draft(), key()).roomId;
  const code = f.api.snapshot(a.user, id).room.inviteCode, prepareKey = key();
  f.api.prepare(a.user, id, { height: 175, weight: 80, version: 1 }, prepareKey);
  f.api.joinRoom(b.user, code, { sharingConsent: true }, key()); f.api.leaveRoom(a.user, id, {}, key());
  assert.equal(f.api.snapshot(b.user, id).room.ownerId, b.user.id);
  rejects(() => f.api.snapshot(a.user, id), 'FORBIDDEN');
  rejects(() => f.api.prepare(a.user, id, { height: 175, weight: 80, version: 1 }, prepareKey), 'FORBIDDEN');
  f.api.joinRoom(a.user, code, { sharingConsent: true }, key()); assert.equal(f.api.snapshot(a.user, id).members.find(m => m.id === a.user.id).ready, false);
  f.api.leaveRoom(b.user, id, {}, key()); assert.equal(f.api.snapshot(a.user, id).room.ownerId, a.user.id);
  f.api.leaveRoom(a.user, id, {}, key()); rejects(() => f.api.getInvite(code, 'x'), 'INVITE_INVALID');
});
test('full invitation recovers when lobby slot frees', async t => {
  const f = fixture(t), users = await Promise.all(Array.from({ length: 9 }, () => f.account()));
  const id = f.api.createRoom(users[0].user, draft(), key()).roomId, code = f.api.snapshot(users[0].user, id).room.inviteCode;
  for (const a of users.slice(1, 8)) f.api.joinRoom(a.user, code, { sharingConsent: true }, key());
  assert.equal(f.api.getInvite(code, 'x').joinable, false);
  rejects(() => f.api.joinRoom(users[8].user, code, { sharingConsent: true }, key()), 'ROOM_FULL');
  f.api.leaveRoom(users[7].user, id, {}, key()); assert.equal(f.api.getInvite(code, 'x').joinable, true);
  f.api.joinRoom(users[8].user, code, { sharingConsent: true }, key());
});
test('late join at 14 days is atomic; 13 days rejected; original goals unchanged', async t => {
  const f = fixture(t), { a, id, code } = await f.active(), c = await f.account(), d = await f.account();
  const target = f.api.snapshot(a.user, id).members[0].target;
  f.tick('2026-10-15'); const before = f.api.snapshot(a.user, id);
  rejects(() => f.api.joinRoom(c.user, code, { sharingConsent: true, date: '2026-10-14', version: before.room.version, height: 175, weight: 80 }, key()), 'INVITE_CHANGED');
  assert.equal(f.api.snapshot(a.user, id).members.length, 2);
  f.api.joinRoom(c.user, code, { sharingConsent: true, date: '2026-10-15', version: before.room.version, height: 175, weight: 80 }, key());
  const s = f.api.snapshot(a.user, id), late = s.members.find(m => m.id === c.user.id);
  assert.equal(late.target, 78.29); assert.equal(late.summary.denominator, 1); assert.equal(s.members[0].target, target); assert.equal(s.room.startDate, '2026-10-01');
  f.tick('2026-10-16'); rejects(() => f.api.joinRoom(d.user, code, { sharingConsent: true }, key()), 'JOIN_WINDOW_CLOSED');
});
test('daily uniqueness, kg/jin equivalence, conflict and date rejection', async t => {
  const f = fixture(t), { a, b, id } = await f.active();
  const body = { date: '2026-10-01', weight: 140, unit: 'jin', version: 0 }, idem = key();
  const first = f.api.saveRecord(a.user, id, body, idem); assert.equal(first.weight, 70); assert.deepEqual(f.api.saveRecord(a.user, id, body, idem), first);
  rejects(() => f.api.saveRecord(a.user, id, { ...body, weight: 141 }, key()), 'VERSION_CONFLICT');
  rejects(() => f.api.saveRecord(a.user, id, { ...body, version: 1 }, key()), 'OVERWRITE_REQUIRED');
  f.api.saveRecord(a.user, id, { ...body, weight: 139, version: 1, overwrite: true }, key());
  assert.equal(f.api.snapshot(b.user, id).members.find(m => m.id === a.user.id).summary.latest.weight, 69.5);
  f.tick('2026-10-02'); rejects(() => f.api.saveRecord(a.user, id, body, key()), 'BUSINESS_DATE_CHANGED');
  assert.equal(f.store.get('SELECT count(*) n FROM records').n, 1);
});
test('midnight start stale, exact expiry, history and slot release', async t => {
  const f = fixture(t), { a, id, code } = await f.active(14);
  f.clock.date = new Date('2026-10-14T15:59:59Z'); f.api.expire(); assert.equal(f.api.snapshot(a.user, id).room.status, 'ACTIVE');
  f.clock.date = new Date('2026-10-14T16:00:00Z'); f.api.expire(); f.api.expire(); assert.equal(f.api.snapshot(a.user, id).room.status, 'ENDED');
  rejects(() => f.api.saveRecord(a.user, id, { date: '2026-10-15', weight: 70, unit: 'kg', version: 0 }, key()), 'ROOM_LOCKED');
  rejects(() => f.api.getInvite(code, 'x'), 'INVITE_INVALID'); assert.equal(f.api.history(a.user).length, 1);
  const otp = await f.api.requestCode({ phone: a.phone }, 'again'), login = f.api.login({ phone: a.phone, code: otp.developmentCode }, 'again');
  const refreshed = f.api.authenticate(login.token); assert.equal(refreshed.current_room_id, null);
  assert.notEqual(f.api.createRoom(refreshed, draft(), key()).roomId, id);
});
test('reminder rounds, per-recipient receipt, late delivery, update invalidation', async t => {
  const f = fixture(t), { a, b, id } = await f.active();
  f.tick('2026-10-02'); assert.equal(f.api.reminders(a.user, id).length, 0);
  f.tick('2026-10-03'); assert.equal(f.api.reminders(a.user, id).length, 2); const claimKey = key(); const claimed = f.api.acknowledgeReminders(a.user, id, {}, claimKey); assert.equal(claimed.reminders.length, 2); assert.equal(f.api.acknowledgeReminders(a.user, id, {}, key()).reminders.length, 0); assert.equal(f.api.reminders(a.user, id).length, 0); assert.equal(f.api.reminders(b.user, id).length, 2);
  f.tick('2026-10-06'); assert.equal(f.api.acknowledgeReminders(a.user, id, {}, claimKey).reminders.length, 0); assert.ok(f.api.reminders(a.user, id).every(r => r.stage === 4)); f.api.acknowledgeReminders(a.user, id, {}, key());
  f.tick('2026-10-07'); assert.equal(f.api.reminders(a.user, id).length, 0);
  f.api.saveRecord(b.user, id, { date: '2026-10-07', weight: 70, unit: 'kg', version: 0 }, key()); assert.equal(f.api.reminders(b.user, id).length, 1);
  f.tick('2026-10-10'); assert.equal(f.api.reminders(a.user, id).length, 1);
});
test('export only self, deletion revokes sessions and removes body data; support persisted', async t => {
  const f = fixture(t), { a, b, id } = await f.active(); f.api.saveRecord(a.user, id, { date: '2026-10-01', weight: 70, unit: 'kg', version: 0 }, key());
  assert.equal(f.api.exportData(b.user).records.length, 0);
  const request = f.api.support(a.user, { message: '测试支持请求' }, key()); assert.equal(f.api.supportList(a.user)[0].id, request.requestId);
  rejects(() => f.api.deleteAccount(a.user, { confirm: 'yes' }), 'CONFIRM_REQUIRED');
  f.api.deleteAccount(a.user, { confirm: '注销并删除我的数据' }); rejects(() => f.api.authenticate(a.token), 'UNAUTHENTICATED');
  assert.equal(f.api.snapshot(b.user, id).members.length, 1); assert.equal(f.store.get('SELECT count(*) n FROM records').n, 0); assert.equal(f.store.get('SELECT count(*) n FROM support_requests').n, 0);
});
test('database survives reopen and does not depend on browser state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chengqun-')), path = join(dir, 'test.sqlite'); let store;
  try { store = openStore(path); const api = createService(store); const code = await api.requestCode({ phone: '13800000001' }, 'persist'), login = api.login({ phone: '13800000001', code: code.developmentCode }, 'persist'); const user = api.authenticate(login.token); api.updateProfile(user, { nickname: '持久化', adult: true, sensitiveConsent: true }, key()); const roomId = api.createRoom(user, draft(), key()).roomId; store.close(); store = openStore(path); const reopened = createService(store); assert.equal(reopened.snapshot(reopened.authenticate(login.token), roomId).room.id, roomId); } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});
