import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSmsConfiguration } from '../apps/api/sms.mjs';

export function checkSms(env = process.env) { return inspectSmsConfiguration(env); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = checkSms();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
