import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Wurzel des Repos (enthält assets/, markets/, dist/). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
