import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openStore } from '../apps/api/store.mjs';
import { createService } from '../apps/api/service.mjs';
import { createBackup, drillRestore, inspectDatabase } from '../scripts/lib/backup.mjs';
const key = () => randomUUID();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cq-deletion-')), path = join(root, 'live.sqlite');
  const store = openStore(path), clock = () => new Date('2026-10-14T03:00:00Z'), api = createService(store, { clock });
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const users = [];
  for (const phone of ['13900009101', '13900009102']) {
    const code = await api.requestCode({ phone }, phone), session = api.login({ phone, code: code.developmentCode }, phone), user = api.authenticate(session.token);
    api.updateProfile(user, { nickname: '测试成员', adult: true, sensitiveConsent: true }, key()); users.push({ user, token: session.token });
  }
  const roomId = api.createRoom(users[0].user, { days: 28, intensity: '低', sharingConsent: true }, key()).roomId;
  api.joinRoom(users[1].user, api.snapshot(users[0].user, roomId).room.inviteCode, { sharingConsent: true }, key());
  for (const { user } of users) api.prepare(user, roomId, { height: 175, weight: 80, version: api.snapshot(user, roomId).room.version }, key());
  api.startRoom(users[0].user, roomId, api.startPreview(users[0].user, roomId), key());
  for (const { user } of users) api.saveRecord(user, roomId, { date: '2026-10-14', weight: 79, unit: 'kg', version: 0 }, key());
  return { root, path, store, api, users, roomId, clock, journalPath: path + '.deletions.sqlite' };
}
test('old snapshot replays current independent deletions before reads; live data and backup remain unchanged', async t => {
  const f = await fixture(t), backup = await createBackup({ databasePath: f.path, backupRoot: join(f.root, 'backups'), clock: f.clock });
  const result = f.api.deleteAccount(f.users[0].user, { confirm: '注销并删除我的数据' });
  assert.equal(result.deletion.onlineStatus, 'COMPLETED');
  assert.equal(result.deletion.backupStatus, 'REPLAY_REQUIRED');
  const live = inspectDatabase(f.path);
  await assert.rejects(drillRestore(backup.directory, { clock: f.clock }), /journal missing/);
  const restored = await drillRestore(backup.directory, { clock: f.clock, deletionJournalPath: f.journalPath });
  assert.equal(restored.users, 1); assert.equal(restored.deletionReplay, true);
  assert.deepEqual(inspectDatabase(f.path), live);
  assert.equal(inspectDatabase(join(backup.directory, 'snapshot.sqlite')).tables.users.count, 2);
  const path = join(f.root, 'copy.sqlite'); await copyFile(join(backup.directory, 'snapshot.sqlite'), path);
  const copy = openStore(path, { deletionJournalPath: f.journalPath, readOnlyJournal: true });
  try {
    const api = createService(copy, { clock: f.clock });
    assert.throws(() => api.authenticate(f.users[0].token), error => error.code === 'UNAUTHENTICATED');
    assert.equal(api.snapshot(api.authenticate(f.users[1].token), f.roomId).members.length, 1);
    for (const table of ['users', 'sessions', 'members', 'records', 'idempotency']) {
      const column = table === 'users' ? 'id' : 'user_id';
      assert.equal(copy.get(`SELECT count(*) n FROM ${table} WHERE ${column}=?`, f.users[0].user.id).n, 0);
    }
    const events = f.store.journal.events(); assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events).includes('13900009101'));
  } finally { copy.close(); }
});
test('durable intent surviving a pre-delete crash is completed at startup; missing or wrong journal refuses startup', async t => {
  const f = await fixture(t);
  f.store.journal.append(f.users[0].user.id, f.clock().toISOString());
  assert.equal(f.store.get('SELECT count(*) n FROM users').n, 2);
  const restarted = createService(f.store, { clock: f.clock });
  assert.equal(f.store.get('SELECT count(*) n FROM users').n, 1);
  assert.equal(restarted.snapshot(f.users[1].user, f.roomId).members.length, 1);
  const wrong = openStore(join(f.root, 'wrong.sqlite')); wrong.close();
  assert.throws(() => openStore(f.path, { deletionJournalPath: join(f.root, 'wrong.sqlite.deletions.sqlite') }), /identity mismatch/);
  assert.throws(() => openStore(f.path, { deletionJournalPath: join(f.root, 'missing.sqlite') }), /journal missing/);
  assert.throws(() => openStore(f.path, { deletionJournalPath: f.path }), /separate/);
  assert.throws(() => openStore(f.path, { deletionJournalPath: ':memory:' }), /persistent deletion journal/);
  const empty = join(f.root, 'empty.sqlite'); await writeFile(empty, '');
  assert.throws(() => openStore(f.path, { deletionJournalPath: empty }), /identity mismatch/);
});

test('support CLI honors the independent journal and completes pending deletions before listing messages', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cq-support-journal-')), path = join(root, 'business.sqlite'), journal = join(root, 'independent.sqlite');
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = openStore(path, { deletionJournalPath: journal });
  try {
    const api = createService(store), phone = '13900009301';
    const code = await api.requestCode({ phone }, phone), session = api.login({ phone, code: code.developmentCode }, phone), user = api.authenticate(session.token);
    api.support(user, { message: 'must disappear before support listing' }, key());
    store.journal.append(user.id, new Date().toISOString());
  } finally { store.close(); }
  const result = execFileSync(process.execPath, [new URL('../scripts/support.mjs', import.meta.url).pathname, 'list'], { env: { DATABASE_PATH: path, DELETION_JOURNAL_PATH: journal }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result), []);
  const reopened = openStore(path, { deletionJournalPath: journal });
  try { assert.equal(reopened.get('SELECT count(*) n FROM users').n, 0); }
  finally { reopened.close(); }
});
