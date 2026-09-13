/**
 * Writes relay-python/julius/brain_schema.json from the TypeScript domain.
 *
 *   npm run julius:brain:schema:export
 *
 * `src/relay/mission/julius/julius-brain-schema-document.test.ts` fails when the
 * committed file is stale, so a schema change cannot land without its export.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderJuliusBrainSchemaDocument } from '../src/relay/mission/julius/julius-brain-schema-document';

const target = resolve(__dirname, '..', 'relay-python', 'julius', 'brain_schema.json');
writeFileSync(target, renderJuliusBrainSchemaDocument());
process.stdout.write(`wrote ${target}\n`);
