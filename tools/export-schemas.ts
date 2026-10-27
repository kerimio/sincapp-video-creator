// Schreibt die JSON-Schemas (für Editoren/Validierung außerhalb von TS) nach schemas/.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Market, Story } from '../src/core/schema';
import { ROOT } from '../src/paths';

for (const [name, schema] of [['market', Market], ['story', Story]] as const) {
  const json = zodToJsonSchema(schema, { name, $refStrategy: 'none' });
  writeFileSync(join(ROOT, 'schemas', `${name}.schema.json`), JSON.stringify(json, null, 2) + '\n');
  console.log(`schemas/${name}.schema.json`);
}
