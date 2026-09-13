import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { renderJuliusBrainSchemaDocument } from './julius-brain-schema-document';

describe('the language-independent Brain schema', () => {
  it('the Python SDK ships exactly the schema the TypeScript domain enforces (run npm run julius:brain:schema:export)', () => {
    const committed = readFileSync(join(__dirname, '..', '..', '..', '..', 'relay-python', 'julius', 'brain_schema.json'), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(renderJuliusBrainSchemaDocument());
  });
});
