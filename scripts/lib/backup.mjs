import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, chmod, copyFile, readFile, writeFile, rename, rm, stat, readdir, open, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createApplication } from '../../apps/api/server.mjs';
import { openStore } from '../../apps/api/store.mjs';
import { createService } from '../../apps/api/service.mjs';

const quote = value => '"' + value.replaceAll('"', '""') + '"';
const requiredTables = ['users', 'sessions', 'otp', 'rooms', 'members', 'records', 'idempotency', 'reminder_receipts', 'support_requests', 'rate_limits'];
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function syncFile(path) { const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); } }

// Read the backup itself, rather than comparing a moving live database to it.
export function inspectDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    db.exec('BEGIN');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('DATABASE_INTEGRITY');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('DATABASE_FOREIGN_KEYS');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (![1, 2].includes(version)) throw new Error('DATABASE_VERSION');
    if (version >= 2 && (!db.prepare('PRAGMA table_info(otp)').all().some(c => c.name === 'delivery_state') || !db.prepare("SELECT name FROM sqlite_schema WHERE name='privacy_meta'").get())) throw new Error('DATABASE_TABLES');
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all();
    const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r => r.name);
    if (requiredTables.some(name => !names.includes(name))) throw new Error('DATABASE_TABLES');
    const tables = {};
    for (const name of names) {
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
      const stmt = db.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${columns.map((_, i) => i + 1).join(',')}`);
      stmt.setReadBigInts(true);
      const hash = createHash('sha256'); let count = 0;
      for (const row of stmt.iterate()) { hash.update(json(row) + '\n'); count++; }
      tables[name] = { count, sha256: hash.digest('hex') };
    }
    return { version, schemaSha256: digest(json(schema)), tables };
  } finally { db.close(); }
}

export async function verifyBackup(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || !manifest.completedAt || !manifest.files?.['snapshot.sqlite']) throw new Error('BACKUP_MANIFEST');
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!['snapshot.sqlite', 'accounts.json', 'app.env', 'application.tgz'].includes(name) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('BACKUP_MANIFEST');
    if (await fileHash(join(directory, name)) !== hash) throw new Error('BACKUP_CHECKSUM');
  }
  if (json(inspectDatabase(join(directory, 'snapshot.sqlite'))) !== json(manifest.database)) throw new Error('BACKUP_CONTENT');
  return manifest;
}

// The only restore operation provided is to a new private temporary directory.
// No command accepts the live database as a restore destination.
export async function drillRestore(directory, { workRoot = tmpdir(), clock, deletionJournalPath } = {}) {
  const started = performance.now(), manifest = await verifyBackup(directory);
  const work = await mkdtemp(join(workRoot, 'payathon-restore-'));
  await chmod(work, 0o700);
  let app;
  try {
    const databasePath = join(work, 'restored.sqlite');
    await copyFile(join(directory, 'snapshot.sqlite'), databasePath);
    await chmod(databasePath, 0o600);
    if (json(inspectDatabase(databasePath)) !== json(manifest.database)) throw new Error('RESTORE_CONTENT');
    // Never use a journal captured at snapshot time: replay the latest independent one.
    const replayStore = openStore(databasePath, { deletionJournalPath, readOnlyJournal: !!deletionJournalPath });
    try { createService(replayStore, { clock }); } finally { replayStore.close(); }
    const accounts = manifest.files['accounts.json'] ? JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8')) : [];
    let recoveredApplication = createApplication;
    if (manifest.files['application.tgz']) {
      const applicationRoot = join(work, 'application'); await mkdir(applicationRoot, { mode: 0o700 });
      execFileSync('tar', ['-xzf', join(directory, 'application.tgz'), '-C', applicationRoot, '--no-same-owner', '--exclude=*/._*'], { timeout: 30000, stdio: 'pipe' });
      recoveredApplication = (await import(pathToFileURL(join(applicationRoot, 'apps/api/server.mjs')).href)).createApplication;
    }
    app = recoveredApplication({ databasePath, clock, deletionJournalPath, readOnlyJournal: !!deletionJournalPath, ...(accounts.length ? { mode: 'test', publicOrigin: manifest.publicOrigin, testAccounts: accounts } : {}) });
    await new Promise((yes, no) => { app.server.once('error', no); app.server.listen(0, '127.0.0.1', yes); });
    const host = accounts.length ? new URL(manifest.publicOrigin).host : '127.0.0.1';
    async function get(path, token) {
      return new Promise((yes, no) => {
        const req = http.get({ hostname: '127.0.0.1', port: app.server.address().port, path: '/api/v1' + path, headers: { Host: host, ...(token ? { Cookie: 'cq_session=' + token } : {}) } }, res => {
          let raw = ''; res.on('data', chunk => { raw += chunk; });
          res.on('end', () => { try { if (res.statusCode !== 200) throw new Error('RESTORE_HTTP'); yes(JSON.parse(raw)); } catch (e) { no(e); } });
        });
        req.setTimeout(5000, () => req.destroy(new Error('RESTORE_TIMEOUT'))); req.on('error', no);
      });
    }
    const health = await get('/health');
    if (!health.ok || !health.storage) throw new Error('RESTORE_HEALTH');
    const config = await get('/config');
    if (config.mode !== (accounts.length ? 'test' : 'local')) throw new Error('RESTORE_MODE');
    let users = 0, rooms = 0;
    for (const user of app.store.all('SELECT id FROM users ORDER BY id')) {
      // Temporary sessions exist only in the isolated copy and are never printed.
      const token = randomBytes(32).toString('hex');
      app.store.run('INSERT INTO sessions VALUES(?,?,?,?)', digest(token), user.id, randomUUID(), (clock ? clock() : new Date()).getTime() + 60000);
      if ((await get('/me', token)).user.id !== user.id) throw new Error('RESTORE_IDENTITY');
      await get('/history', token);
      await get('/support', token);
      for (const row of app.store.all("SELECT DISTINCT room_id FROM members WHERE user_id=? AND state='JOINED'", user.id)) {
        const snapshot = await get('/rooms/' + encodeURIComponent(row.room_id), token);
        if (snapshot.room.id !== row.room_id || !Array.isArray(snapshot.members) || snapshot.members.some(m => !Array.isArray(m.records))) throw new Error('RESTORE_ROOM');
        const expected = app.store.get("SELECT count(*) n FROM records r JOIN members m ON m.room_id=r.room_id AND m.user_id=r.user_id WHERE r.room_id=? AND m.state='JOINED'", row.room_id).n;
        if (snapshot.members.reduce((n, m) => n + m.records.length, 0) !== expected) throw new Error('RESTORE_RECORDS');
        rooms++;
      }
      users++;
    }
    return { ok: true, users, roomReads: rooms, deletionReplay: !!deletionJournalPath, durationMs: Math.round(performance.now() - started) };
  } finally { try { if (app) await app.close(); } finally { await rm(work, { recursive: true, force: true }); } }
}

export async function createBackup({ databasePath, backupRoot, configDirectory, publicOrigin, release, clock, deletionJournalPath }) {
  const sourcePath = await realpath(databasePath), root = resolve(backupRoot);
  if (!(await stat(sourcePath)).isFile()) throw new Error('DATABASE_FILE');
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  const startedAt = new Date().toISOString(), id = startedAt.replaceAll(/[:.]/g, '-') + '-' + randomUUID();
  const staging = join(root, '.pending-' + id), destination = join(root, id);
  await mkdir(staging, { mode: 0o700 });
  try {
    const db = new DatabaseSync(sourcePath, { readOnly: true, timeout: 5000 });
    try { await backup(db, join(staging, 'snapshot.sqlite')); } finally { db.close(); }
    // A portable backup is one closed database file, without WAL/SHM sidecars.
    const snapshot = new DatabaseSync(join(staging, 'snapshot.sqlite'));
    try { snapshot.exec('PRAGMA journal_mode=DELETE'); } finally { snapshot.close(); }
    await chmod(join(staging, 'snapshot.sqlite'), 0o600);
    const files = { 'snapshot.sqlite': await fileHash(join(staging, 'snapshot.sqlite')) };
    if (configDirectory) {
      for (const name of ['accounts.json', 'app.env']) {
        await copyFile(join(configDirectory, name), join(staging, name));
        await chmod(join(staging, name), 0o600);
        files[name] = await fileHash(join(staging, name));
      }
    }
    if (release) {
      // Fixed allowlist: never archive var/, .env, .git or unrelated host files.
      execFileSync('tar', ['-czf', join(staging, 'application.tgz'), '-C', await realpath(release), 'apps', 'packages', 'db', 'package.json', 'package-lock.json', '.node-version'], { timeout: 30000, stdio: 'pipe', env: { ...process.env, COPYFILE_DISABLE: '1' } });
      await chmod(join(staging, 'application.tgz'), 0o600);
      files['application.tgz'] = await fileHash(join(staging, 'application.tgz'));
    }
    const manifest = { format: 1, startedAt, completedAt: new Date().toISOString(), release, nodeVersion: process.version, publicOrigin, files, database: inspectDatabase(join(staging, 'snapshot.sqlite')) };
    await writeFile(join(staging, 'manifest.json'), json(manifest) + '\n', { mode: 0o600 });
    manifest.restore = await drillRestore(staging, { clock, deletionJournalPath: deletionJournalPath || (manifest.database.version >= 2 ? sourcePath + '.deletions.sqlite' : undefined) });
    manifest.completedAt = new Date().toISOString();
    await writeFile(join(staging, 'manifest.json'), json(manifest) + '\n', { mode: 0o600 });
    for (const name of [...Object.keys(files), 'manifest.json']) await syncFile(join(staging, name));
    await syncFile(staging);
    await rename(staging, destination); await syncFile(root);
    return { directory: destination, manifest };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

export async function latestBackup(root) {
  const entries = (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name)).map(e => e.name).sort().reverse();
  if (!entries.length) throw new Error('BACKUP_MISSING');
  // Fail closed if the newest completed bundle is damaged; do not mask it with an older one.
  const directory = join(root, entries[0]);
  return { directory, manifest: await verifyBackup(directory) };
}
