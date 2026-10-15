// Exercise a missing-backup alert and its recovery without changing live services/data.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectStatus, saveStatus } from './lib/monitor.mjs';

const work = await mkdtemp(join(tmpdir(), 'payathon-monitor-drill-'));
try {
  assert.ok(process.env.PUBLIC_ORIGIN && process.env.BACKUP_ROOT, 'Operations configuration required');
  const empty = join(work, 'empty'); await mkdir(empty, { mode: 0o700 });
  const config = { publicOrigin: process.env.PUBLIC_ORIGIN, databaseDirectory: '/var/lib/payathon-test' };
  const failed = await collectStatus({ ...config, backupRoot: empty });
  assert.ok(!failed.ok && failed.issues.includes('BACKUP_INVALID') && failed.issues.includes('BACKUP_STALE'));
  assert.equal(await saveStatus(work, failed), true);
  const recovered = await collectStatus({ ...config, backupRoot: process.env.BACKUP_ROOT });
  assert.equal(recovered.ok, true, JSON.stringify(recovered.issues));
  assert.equal(await saveStatus(work, recovered), true);
  console.log(JSON.stringify({ event: 'monitor_drill_completed', detected: failed.issues, recovered: recovered.ok }));
} finally { await rm(work, { recursive: true, force: true }); }
