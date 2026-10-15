import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import { openStore } from '../apps/api/store.mjs';
import { createService } from '../apps/api/service.mjs';
import { createBackup, drillRestore, verifyBackup, inspectDatabase, latestBackup } from '../scripts/lib/backup.mjs';
import { evaluate, probeHealth, saveStatus } from '../scripts/lib/monitor.mjs';

const key = () => randomUUID();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'payathon-ops-test-'));
  const databasePath = join(root, 'live.sqlite'), backupRoot = join(root, 'backups');
  const store = openStore(databasePath), clock = () => new Date('2026-10-14T08:00:00Z'), api = createService(store, { clock });
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const users = [];
  for (const phone of ['13900008001', '13900008002']) {
    const otp = await api.requestCode({ phone }, phone), login = api.login({ phone, code: otp.developmentCode }, phone);
    let user = api.authenticate(login.token);
    api.updateProfile(user, { nickname: '恢复测试', adult: true, sensitiveConsent: true }, key());
    users.push(api.authenticate(login.token));
  }
  const roomId = api.createRoom(users[0], { name: '恢复测试组', intro: '', days: 28, intensity: '低', sharingConsent: true }, key()).roomId;
  api.joinRoom(users[1], api.snapshot(users[0], roomId).room.inviteCode, { sharingConsent: true }, key());
  for (const user of users) api.prepare(user, roomId, { height: 175, weight: 80, version: api.snapshot(user, roomId).room.version }, key());
  api.startRoom(users[0], roomId, api.startPreview(users[0], roomId), key());
  for (const user of users) api.saveRecord(user, roomId, { date: '2026-10-14', weight: 79, unit: 'kg', version: 0 }, key());
  api.support(users[0], { message: '恢复后仍应能查询的请求' }, key());
  return { root, databasePath, backupRoot, store, api, users, roomId, clock, options: { databasePath, backupRoot, clock } };
}

test('online WAL backup restores all tables and both identities through isolated HTTP without altering live data', async t => {
  const f = await fixture(t), before = inspectDatabase(f.databasePath);
  assert.ok((await stat(f.databasePath + '-wal')).size > 0);
  const { directory, manifest } = await createBackup(f.options);
  assert.deepEqual(manifest.database, before);
  assert.equal(manifest.restore.ok, true); assert.equal(manifest.restore.users, 2); assert.equal(manifest.restore.roomReads, 2);
  assert.deepEqual(inspectDatabase(f.databasePath), before);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const file of ['snapshot.sqlite', 'manifest.json']) assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
  assert.equal((await latestBackup(f.backupRoot)).directory, directory);
  assert.ok(!(await readdir(directory)).some(name => /-(wal|shm)$/.test(name)));
  const drill = await drillRestore(directory, { workRoot: f.root, clock: f.clock, deletionJournalPath: f.databasePath + '.deletions.sqlite' });
  assert.equal(drill.users, 2); assert.ok(!(await readdir(f.root)).some(name => name.startsWith('payathon-restore-')));
  f.api.saveRecord(f.users[0], f.roomId, { date: '2026-10-14', weight: 78, unit: 'kg', version: 1, overwrite: true }, key());
  assert.deepEqual((await verifyBackup(directory)).database, before);
  assert.equal(f.store.get('SELECT weight FROM records WHERE user_id=?', f.users[0].id).weight, 78);
});

test('test identity configuration is preserved privately and used for test-mode recovery', async t => {
  const f = await fixture(t), configDirectory = join(f.root, 'config'); await mkdir(configDirectory);
  const accounts = [1, 2].map(i => ({ id: 'restore-' + i, nickname: '测试', codeHash: createHash('sha256').update('test-only-' + i).digest('hex') }));
  await writeFile(join(configDirectory, 'accounts.json'), JSON.stringify(accounts));
  await writeFile(join(configDirectory, 'app.env'), 'APP_MODE=test\nPRIVATE_SENTINEL=not-for-logs\n');
  const result = await createBackup({ ...f.options, configDirectory, publicOrigin: 'https://test.example.com', release: process.cwd() });
  assert.equal(result.manifest.restore.users, 2);
  assert.equal(await readFile(join(result.directory, 'app.env'), 'utf8'), 'APP_MODE=test\nPRIVATE_SENTINEL=not-for-logs\n');
  assert.equal(JSON.stringify(result.manifest).includes('PRIVATE_SENTINEL'), false);
  assert.equal((await stat(join(result.directory, 'accounts.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(result.directory, 'application.tgz'))).mode & 0o777, 0o600);
});

test('damaged backup or missing live database fails closed and no unfinished bundle is published', async t => {
  const f = await fixture(t);
  await assert.rejects(createBackup({ ...f.options, databasePath: join(f.root, 'absent.sqlite') }));
  const { directory } = await createBackup(f.options);
  await writeFile(join(directory, 'snapshot.sqlite'), 'corrupt');
  await assert.rejects(verifyBackup(directory), /BACKUP_CHECKSUM/);
  await assert.rejects(drillRestore(directory), /BACKUP_CHECKSUM/);
  await assert.rejects(latestBackup(f.backupRoot), /BACKUP_CHECKSUM/);
  await assert.rejects(createBackup({ ...f.options, configDirectory: join(f.root, 'absent-config') }));
  assert.deepEqual((await readdir(f.backupRoot)).filter(name => name.startsWith('.pending-')), []);
  assert.equal(f.store.get('SELECT count(*) n FROM records').n, 2);
});

test('unsupported schema and broken foreign keys cannot become successful backups', async t => {
  const f = await fixture(t);
  f.store.db.exec('PRAGMA user_version=999');
  await assert.rejects(createBackup(f.options), /DATABASE_VERSION/);
  f.store.db.exec("PRAGMA user_version=2; PRAGMA foreign_keys=OFF; INSERT INTO sessions VALUES('orphan','missing','x',123)");
  await assert.rejects(createBackup(f.options), /DATABASE_FOREIGN_KEYS/);
  assert.deepEqual(await readdir(f.backupRoot), []);
});

const healthy = () => ({ services: true, backupJobSucceeded: true, localHealth: { ok: true, durationMs: 10 }, publicHealth: { ok: true, durationMs: 50 }, certificateHours: 100, backupAgeHours: 0.1, backupVerified: true, freeBytes: 1024 ** 3, freeRatio: 0.5, applicationErrors: 0 });
test('monitor detects outages, stale/corrupt backup, expiring TLS, low disk and journal failures', () => {
  assert.deepEqual(evaluate(healthy()), { ok: true, issues: [] });
  for (const [patch, issue] of [
    [{ services: false }, 'SERVICE_INACTIVE'], [{ backupJobSucceeded: false }, 'BACKUP_JOB_FAILED'], [{ localHealth: { ok: false } }, 'LOCAL_HEALTH'],
    [{ publicHealth: { ok: false } }, 'PUBLIC_HEALTH'], [{ certificateHours: 23 }, 'CERTIFICATE_EXPIRING'],
    [{ backupVerified: false }, 'BACKUP_INVALID'], [{ backupAgeHours: 2.1 }, 'BACKUP_STALE'],
    [{ backupAgeHours: null }, 'BACKUP_STALE'], [{ freeBytes: 100 }, 'DISK_LOW'],
    [{ freeRatio: 0.01 }, 'DISK_LOW'], [{ applicationErrors: 1 }, 'APPLICATION_ERRORS'],
    [{ applicationErrors: null }, 'APPLICATION_ERRORS'], [{ publicHealth: { ok: true, durationMs: 2100 } }, 'HEALTH_SLOW']
  ]) assert.ok(evaluate({ ...healthy(), ...patch }).issues.includes(issue), issue);
});

test('health probe rejects wrong JSON, unhealthy storage, redirects and connection failure', async t => {
  let body = { ok: true, storage: true, mode: 'test' }, status = 200;
  const server = http.createServer((req, res) => { res.writeHead(status, { 'Content-Type': 'application/json', Location: '/elsewhere' }); res.end(JSON.stringify(body)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await probeHealth(url)).ok, true);
  body.storage = false; assert.equal((await probeHealth(url)).ok, false);
  body = { ok: true, storage: true, mode: 'development' }; assert.equal((await probeHealth(url)).ok, false);
  body = 'not a health response'; assert.equal((await probeHealth(url)).ok, false);
  status = 302; assert.equal((await probeHealth(url)).ok, false);
  await new Promise(resolve => server.close(resolve)); assert.equal((await probeHealth(url)).ok, false);
});

test('status records failure and recovery, preserving no-op quiet checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'payathon-monitor-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await saveStatus(root, { checkedAt: 'one', ...evaluate(healthy()) }), true);
  assert.equal(await saveStatus(root, { checkedAt: 'two', ...evaluate(healthy()) }), false);
  assert.equal(await saveStatus(root, { ...evaluate({ ...healthy(), services: false }) }), true);
  assert.equal(await saveStatus(root, { ...evaluate(healthy()) }), true);
  assert.equal(JSON.parse(await readFile(join(root, 'status.json'), 'utf8')).ok, true);
  assert.equal((await stat(join(root, 'status.json'))).mode & 0o777, 0o600);
});
