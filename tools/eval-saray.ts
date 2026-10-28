/**
 * Abnahme-Lauf: die 6 Saray-Seiten durch die Extraktion schicken und gegen
 * reference/samples/saray-2026-10-28/ground-truth.json prüfen.
 *   pnpm eval:saray              → echter Lauf mit Claude oder Gemini (braucht ANTHROPIC_API_KEY oder GEMINI_API_KEY)
 *   pnpm eval:saray --recorded   → mit den handannotierten Antworten (offline)
 * Weitere Optionen werden an `sincapp-story extract` durchgereicht (z. B. --no-cutout).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/paths';

const SAMPLES = join(ROOT, 'reference/samples/saray-2026-10-28');
const JOB = join(ROOT, 'jobs/saray-eval');
const args = process.argv.slice(2);
const recorded = args.includes('--recorded');
const pass = args.filter((a) => a !== '--recorded');

rmSync(JOB, { recursive: true, force: true });
mkdirSync(join(JOB, 'input'), { recursive: true });
for (const f of readdirSync(SAMPLES)) if (f.endsWith('.png')) cpSync(join(SAMPLES, f), join(JOB, 'input', f));

const r = spawnSync(
  process.execPath,
  ['--import', 'tsx', join(ROOT, 'src/cli/index.ts'), 'extract', JOB, '--eval', join(SAMPLES, 'ground-truth.json'), ...(recorded ? ['--recorded', join(ROOT, 'test/fixtures/saray-extraction')] : []), ...pass],
  { stdio: 'inherit', cwd: ROOT },
);
console.log(`Bericht: ${join(JOB, 'report.md')}`);
process.exit(r.status ?? 1);
