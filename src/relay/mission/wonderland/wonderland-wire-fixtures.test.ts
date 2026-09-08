import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { JULIUS_VISUAL_STATES } from './wonderland-julius-state';
import { WONDERLAND_WORKER_ROLES } from './wonderland-envelope';
import { wonderlandWireEnums } from './wonderland-wire-contract';
import {
  WONDERLAND_WIRE_FIXTURES_PATH,
  renderWonderlandWireFixtures,
} from '../../../../scripts/export-wonderland-wire-fixtures';

/**
 * THE CANONICAL FIXTURES, AS A CONTRACT WITH THE C++ SIDE.
 *
 * `wonderland/Tools/wire-decode-check.sh` drives these through the real decoder
 * and asserts each verdict; that is where the DECODING is proven. This is the
 * other half: that the file is fresh, that it covers both vocabularies whole,
 * and that nothing crosses in it which the client contract excludes.
 *
 * The pairing is what makes either half worth anything. A stale fixture file
 * passes the C++ harness forever — proving that last month's shapes still
 * decode — and a fresh one nobody drives proves nothing at all.
 */

const PATH = WONDERLAND_WIRE_FIXTURES_PATH;
const lines = readFileSync(join(process.cwd(), PATH), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');
const rows = lines.map((line) => {
  const [name, expect_, json] = line.split('\t');
  return { name, expect: expect_, json };
});

describe('the fixture file', () => {
  it('is committed, not generated into an ignored directory', () => {
    // `generated/` is gitignored, so fixtures written there vanish on a fresh
    // checkout and the harness reports success over an empty file. The ordering
    // case table lives in the source tree for the same reason.
    expect(PATH.startsWith('wonderland/')).toBe(true);
    expect(rows.length).toBeGreaterThan(30);
  });

  it('is what the generator renders right now', () => {
    // The half that keeps the C++ harness honest. A stale file passes it
    // forever, proving only that last month's shapes still decode.
    expect(
      readFileSync(join(process.cwd(), PATH), 'utf8'),
      'the wire fixtures are stale — run `npm run wonderland:wire:fixtures` and READ the diff',
    ).toBe(renderWonderlandWireFixtures());
  });

  it('parses as three columns on every line', () => {
    for (const row of rows) {
      expect(row.name, `name on ${row.name}`).toBeTruthy();
      expect(row.expect, `expect on ${row.name}`).toBeTruthy();
      expect(() => JSON.parse(row.json), `json on ${row.name}`).not.toThrow();
    }
  });

  it('names only refusals the decoder can actually return', () => {
    // Taken from the C++ header, so a fixture cannot expect a reason that does
    // not exist — the harness would then compare two strings that never match
    // and report a failure nobody can act on.
    const header = readFileSync(
      join(process.cwd(), 'wonderland', 'Source', 'Wonderland', 'WonderlandWireDecode.h'), 'utf8');
    const known = new Set(['ok']);
    for (const match of header.matchAll(/^\t(\w+)(?:\s*=\s*0)?,?$/gm)) {
      known.add(match[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
    }
    for (const row of rows) {
      expect(known.has(row.expect), `${row.name} expects "${row.expect}"`).toBe(true);
    }
  });

  it('carries both accepted and refused cases, in quantity', () => {
    const accepted = rows.filter((r) => r.expect === 'ok');
    const refused = rows.filter((r) => r.expect !== 'ok');
    expect(accepted.length).toBeGreaterThan(10);
    expect(refused.length).toBeGreaterThan(10);
  });
});

describe('the vocabularies cross whole', () => {
  it('exercises every visual state', () => {
    // A state added on one side and not the other is exactly the drift the
    // pairing exists to catch — and it is caught by NAME, as `unknown_token`,
    // rather than by a world quietly showing Unobserved.
    for (const state of JULIUS_VISUAL_STATES) {
      expect(rows.some((r) => r.name === `state-${state}`), `no fixture for ${state}`).toBe(true);
    }
  });

  it('exercises every worker role', () => {
    for (const role of WONDERLAND_WORKER_ROLES) {
      expect(rows.some((r) => r.name === `role-${role}`), `no fixture for ${role}`).toBe(true);
    }
  });

  it('sends a token the decoder must refuse for each enum it reads', () => {
    // Coverage of the refusal path, not just the happy one. Each of the three
    // decoded enums has a fixture naming something outside its vocabulary.
    const decoded = wonderlandWireEnums()
      .filter((e) => ['EWonderlandJuliusState', 'EWonderlandJuliusStateSource', 'EWonderlandWorkerRole']
        .includes(e.cppEnum));
    expect(decoded.length).toBe(3);
    const unknownTokenCases = rows.filter((r) => r.expect === 'unknown_token');
    expect(unknownTokenCases.length).toBeGreaterThanOrEqual(3);
  });
});

describe('nothing crosses that the client contract excludes', () => {
  const everything = rows.map((r) => r.json).join(' ').toLowerCase();

  it('carries no provider or model name', () => {
    for (const name of ['gpt', 'claude', 'hermes', 'openai', 'anthropic', 'xai', 'gemini', 'codex']) {
      expect(everything, `a fixture mentions ${name}`).not.toContain(name);
    }
  });

  it('carries no credential, and proves the sanitiser is why', () => {
    // The `metadata-dropped` fixture is BUILT with a secret-shaped key. That it
    // is absent here is the sanitiser working on the real construction path —
    // not a fixture that politely omitted one.
    const dropped = rows.find((r) => r.name === 'metadata-dropped');
    expect(dropped).toBeDefined();
    const parsed = JSON.parse(dropped!.json) as {
      metadata: Record<string, unknown>; metadataDropped: number;
    };
    expect(Object.keys(parsed.metadata)).toEqual(['kept']);
    // And it SAYS one was dropped, without saying which — naming the key would
    // tell a viewer a credential exists.
    expect(parsed.metadataDropped).toBe(1);
    expect(dropped!.json).not.toContain('apiKey');
    expect(dropped!.json).not.toContain('sk-');
  });

  it('carries no free text a project author wrote', () => {
    // Every accepted fixture's fields are identifiers, closed-vocabulary tokens,
    // numbers or timestamps. Prose — a Project Brain entry, a safe summary, a
    // reasoning trace — has no field on this shape to occupy, and this notices
    // if one appears.
    for (const row of rows.filter((r) => r.expect === 'ok')) {
      const value = JSON.parse(row.json) as Record<string, unknown>;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string') continue;
        expect(item.length, `${row.name}.${key} is long enough to be prose`).toBeLessThan(120);
        expect(item, `${row.name}.${key} contains a sentence`).not.toMatch(/\.\s+[A-Z]/);
      }
    }
  });
});
