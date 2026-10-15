import { statfs, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import tls from 'node:tls';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { latestBackup } from './backup.mjs';

export function evaluate({ services, backupJobSucceeded, localHealth, publicHealth, certificateHours, backupAgeHours, backupVerified, freeBytes, freeRatio, applicationErrors }) {
  const issues = [];
  if (!services) issues.push('SERVICE_INACTIVE');
  if (!backupJobSucceeded) issues.push('BACKUP_JOB_FAILED');
  if (!localHealth.ok) issues.push('LOCAL_HEALTH');
  if (!publicHealth.ok) issues.push('PUBLIC_HEALTH');
  if (localHealth.durationMs > 2000 || publicHealth.durationMs > 2000) issues.push('HEALTH_SLOW');
  if (!Number.isFinite(certificateHours) || certificateHours < 24) issues.push('CERTIFICATE_EXPIRING');
  if (!backupVerified) issues.push('BACKUP_INVALID');
  if (!Number.isFinite(backupAgeHours) || backupAgeHours < -0.1 || backupAgeHours > 2) issues.push('BACKUP_STALE');
  if (!Number.isFinite(freeBytes) || !Number.isFinite(freeRatio) || freeBytes < 256 * 1024 * 1024 || freeRatio < 0.05) issues.push('DISK_LOW');
  if (applicationErrors === null || applicationErrors > 0) issues.push('APPLICATION_ERRORS');
  return { ok: !issues.length, issues };
}

export async function probeHealth(url, expectedMode = 'test') {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    const data = await response.json();
    return { ok: response.status === 200 && data.ok === true && data.storage === true && data.mode === expectedMode, durationMs: Math.round(performance.now() - started) };
  } catch { return { ok: false, durationMs: Math.round(performance.now() - started) }; }
}

export function probeCertificate(origin) {
  const url = new URL(origin);
  return new Promise(resolve => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), ...(isIP(url.hostname) ? {} : { servername: url.hostname }), rejectUnauthorized: true });
    socket.setTimeout(8000, () => socket.destroy(new Error('TLS_TIMEOUT')));
    socket.once('secureConnect', () => { const hours = (new Date(socket.getPeerCertificate().valid_to).getTime() - Date.now()) / 3600000; socket.end(); resolve(hours); });
    socket.once('error', () => resolve(null));
  });
}

export async function collectStatus({ publicOrigin, backupRoot, databaseDirectory }) {
  const units = ['payathon-test.service', 'nginx.service', 'payathon-cert-renew.timer', 'payathon-backup.timer', 'payathon-monitor.timer'];
  const services = spawnSync('systemctl', ['is-active', ...units], { encoding: 'utf8', timeout: 5000 });
  const backupJob = spawnSync('systemctl', ['show', 'payathon-backup.service', '--property=Result', '--value'], { encoding: 'utf8', timeout: 5000 });
  const journal = spawnSync('journalctl', ['-u', 'payathon-test.service', '--since', '6 minutes ago', '-o', 'cat', '--no-pager', '-n', '1000'], { encoding: 'utf8', timeout: 5000 });
  const applicationErrors = journal.status === 0 ? journal.stdout.split('\n').filter(line => /"error"\s*:|Expiration job failed/.test(line)).length : null;
  const [localHealth, publicHealth, certificateHours] = await Promise.all([
    probeHealth('http://127.0.0.1:4181/api/v1/health'),
    probeHealth(new URL('/api/v1/health', publicOrigin)),
    probeCertificate(publicOrigin)
  ]);
  let backupAgeHours = null, backupVerified = false;
  try {
    const { manifest } = await latestBackup(backupRoot);
    backupAgeHours = (Date.now() - new Date(manifest.startedAt).getTime()) / 3600000;
    backupVerified = manifest.restore?.ok === true;
  } catch { /* A failed verification must surface as an issue. */ }
  let freeBytes = null, freeRatio = null;
  try { const fs = await statfs(databaseDirectory); freeBytes = fs.bavail * fs.bsize; freeRatio = fs.bavail / fs.blocks; } catch { /* Report DISK_LOW rather than silently skipping. */ }
  const checks = { services: services.status === 0 && services.stdout.trim().split('\n').length === units.length && services.stdout.trim().split('\n').every(s => s === 'active'), backupJobSucceeded: backupJob.status === 0 && backupJob.stdout.trim() === 'success', localHealth, publicHealth, certificateHours, backupAgeHours, backupVerified, freeBytes, freeRatio, applicationErrors };
  return { checkedAt: new Date().toISOString(), ...evaluate(checks), checks };
}

export async function saveStatus(directory, status) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'status.json'); let previous;
  try { previous = JSON.parse(await readFile(path, 'utf8')); } catch { /* First or unreadable state is reported. */ }
  const temp = join(directory, '.status-' + randomUUID());
  await writeFile(temp, JSON.stringify(status) + '\n', { mode: 0o600 }); await rename(temp, path);
  return !previous || JSON.stringify(previous.issues) !== JSON.stringify(status.issues);
}
