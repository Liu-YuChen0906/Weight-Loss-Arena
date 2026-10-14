import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
let count = 0;
function walk(path) { for (const entry of readdirSync(path, { withFileTypes: true })) { const file = resolve(path, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(mjs|js)$/.test(entry.name)) { const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }); if (result.status) process.exit(result.status); count++; } } }
for (const dir of ['apps', 'packages', 'scripts', 'tests']) walk(dir);
console.log(`Syntax checked ${count} JavaScript modules.`);
