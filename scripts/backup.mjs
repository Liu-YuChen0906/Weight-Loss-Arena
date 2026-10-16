import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import { createBackup, drillRestore, latestBackup } from './lib/backup.mjs';

async function main() {
  const [command, directory] = process.argv.slice(2);
  if (command === 'create') {
    if (!process.env.DATABASE_PATH || !process.env.BACKUP_ROOT) throw new Error('BACKUP_CONFIG');
    const result = await createBackup({ databasePath: process.env.DATABASE_PATH, backupRoot: process.env.BACKUP_ROOT, deletionJournalPath: process.env.DELETION_JOURNAL_PATH, configDirectory: process.env.APP_MODE === 'sms-trial' ? undefined : process.env.BACKUP_CONFIG_DIRECTORY, publicOrigin: process.env.PUBLIC_ORIGIN, release: await realpath(process.env.APP_RELEASE || '.') });
    console.log(JSON.stringify({ event: 'backup_completed', directory: result.directory, restore: result.manifest.restore }));
  } else if (command === 'drill') {
    const source = directory || (await latestBackup(process.env.BACKUP_ROOT)).directory;
    console.log(JSON.stringify({ event: 'restore_drill_completed', ...await drillRestore(source, { deletionJournalPath: process.env.DELETION_JOURNAL_PATH || (process.env.DATABASE_PATH ? process.env.DATABASE_PATH + '.deletions.sqlite' : undefined) }) }));
  } else throw new Error('Usage: node scripts/backup.mjs create|drill [backup-directory]');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ event: 'backup_failed', code: error.code || (/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : error.name) })); process.exitCode = 1; });
}
