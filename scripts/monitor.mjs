import { collectStatus, saveStatus } from './lib/monitor.mjs';

try {
  if (!process.env.PUBLIC_ORIGIN || !process.env.BACKUP_ROOT || !process.env.MONITOR_ROOT) throw new Error('MONITOR_CONFIG');
  const status = await collectStatus({ publicOrigin: process.env.PUBLIC_ORIGIN, backupRoot: process.env.BACKUP_ROOT, databaseDirectory: '/var/lib/payathon-test', expectedMode: process.env.APP_MODE || 'test' });
  const changed = await saveStatus(process.env.MONITOR_ROOT, status);
  if (changed || !status.ok) console.log(JSON.stringify({ event: status.ok ? 'monitor_recovered' : 'monitor_failed', checkedAt: status.checkedAt, issues: status.issues }));
  if (!status.ok) process.exitCode = 1;
} catch (error) {
  if (process.env.MONITOR_ROOT) {
    try { await saveStatus(process.env.MONITOR_ROOT, { checkedAt: new Date().toISOString(), ok: false, issues: ['MONITOR_INTERNAL'] }); } catch { /* Failed service still records the error in journald. */ }
  }
  console.error(JSON.stringify({ event: 'monitor_failed', code: error.code || error.name })); process.exitCode = 1;
}
