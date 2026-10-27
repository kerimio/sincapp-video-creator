#!/usr/bin/env node
// Startet die TypeScript-CLI über tsx (kein Build-Schritt nötig).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src/cli/index.ts'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
