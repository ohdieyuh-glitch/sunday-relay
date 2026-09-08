import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  WONDERLAND_WIRE_CONTRACT_VERSION,
  WONDERLAND_WIRE_DECODE_RULES,
  wonderlandCppEnumMember,
  wonderlandWireCarrierFields,
  wonderlandWireContract,
  wonderlandWireEnums,
} from './wonderland-wire-contract';
import {
  WONDERLAND_CPP_NULLABLE_CARRIERS,
  WONDERLAND_CPP_STRUCT_PARITY,
  WONDERLAND_NULLABLE_FIELDS,
} from './wonderland-contracts';
import { WONDERLAND_INTEGRATION_NULLABLE_FIELDS } from './wonderland-integration-parity';
import {
  WONDERLAND_WIRE_CONTRACT_PATH,
  renderWonderlandWireContract,
} from '../../../../scripts/export-wonderland-wire-contract';

/**
 * THE DECODE CONTRACT, AND THE DOCUMENT THAT PUBLISHES IT.
 *
 * Two things are proven here. That the contract is DERIVED — it cannot name a
 * field the parity tables do not, or miss one they do, so it cannot describe a
 * seam the headers no longer have. And that the committed document is what the
 * contract currently renders, so the file an engine session reads is the
 * contract rather than a memory of it.
 *
 * The mapping itself is held to the REAL HEADERS in
 * `wonderland-cpp-parity.test.ts` — running forwards, landing on a member that
 * exists. That check found a genuine gap the first time it ran (`LIVE LOCAL`
 * splits on a SPACE), which is the reason it is a test and not a comment.
 */

describe('the token mapping a decoder runs forwards', () => {
  it('turns every separator shape Relay uses into one PascalCase name', () => {
    expect(wonderlandCppEnumMember('independent_review')).toBe('IndependentReview');
    expect(wonderlandCppEnumMember('coding')).toBe('Coding');
    // SCREAMING_SNAKE loses its shouting; only the first letter of each part
    // survives as a capital.
    expect(wonderlandCppEnumMember('PROMPT_ARCHITECT')).toBe('PromptArchitect');
    // A SPACE separates too. This is the case the parity check caught.
    expect(wonderlandCppEnumMember('LIVE LOCAL')).toBe('LiveLocal');
    expect(wonderlandCppEnumMember('LIVE PROVIDER')).toBe('LiveProvider');
  });

  it('leaves an already-mixed-case part alone rather than flattening it', () => {
    expect(wonderlandCppEnumMember('bKnown')).toBe('BKnown');
    expect(wonderlandCppEnumMember('promptArchitect')).toBe('PromptArchitect');
  });

  it('is stable under repeated application, so a double-decode is harmless', () => {
    for (const token of ['independent_review', 'PROMPT_ARCHITECT', 'LIVE LOCAL']) {
      const once = wonderlandCppEnumMember(token);
      expect(wonderlandCppEnumMember(once)).toBe(once);
    }
  });

  it('produces nothing from nothing rather than a stray capital', () => {
    expect(wonderlandCppEnumMember('')).toBe('');
    expect(wonderlandCppEnumMember('___')).toBe('');
  });
});

describe('the contract is derived, not declared', () => {
  it('lists exactly the nullable fields the parity manifests name', () => {
    // The manifests are themselves proven exact against their interfaces by
    // `SameKeys` in the parity modules, so this is the third link in a chain
    // that starts at `tsc` and ends at the real headers.
    const expected = new Set<string>();
    const manifests = { ...WONDERLAND_NULLABLE_FIELDS, ...WONDERLAND_INTEGRATION_NULLABLE_FIELDS };
    for (const entry of WONDERLAND_CPP_STRUCT_PARITY) {
      for (const field of manifests[entry.cppStruct] ?? []) {
        expected.add(`${entry.cppStruct}.${field}`);
      }
    }
    const listed = new Set(
      wonderlandWireCarrierFields()
        .filter((c) => WONDERLAND_CPP_STRUCT_PARITY.some((e) => e.cppStruct === c.cppStruct))
        .map((c) => `${c.cppStruct}.${c.field}`),
    );
    for (const key of expected) expect(listed.has(key), `${key} is missing`).toBe(true);
  });

  it('names only carriers the contract actually approves', () => {
    expect(wonderlandWireContract().carrierTypes).toEqual([...WONDERLAND_CPP_NULLABLE_CARRIERS]);
  });

  it('reports something on both axes, so an empty table is never agreement', () => {
    // The regex-that-matched-nothing failure, in table form: a derivation that
    // quietly produced no rows would publish a document saying a decoder has
    // nothing to do.
    const contract = wonderlandWireContract();
    expect(contract.carriers.length).toBeGreaterThan(20);
    expect(contract.enums.length).toBeGreaterThan(10);
    expect(contract.structs.length).toBeGreaterThan(20);
    expect(contract.schemaVersion).toBe(WONDERLAND_WIRE_CONTRACT_VERSION);
  });

  it('gives every enum member a mapping, and no member two', () => {
    for (const entry of wonderlandWireEnums()) {
      const produced = entry.members.map((m) => m.cppMember);
      expect(produced.length, `${entry.cppEnum} has no members`).toBeGreaterThan(0);
      // A collision would silently merge two Relay states into one C++ member.
      expect(new Set(produced).size, `${entry.cppEnum} maps two tokens to one member`)
        .toBe(produced.length);
      for (const member of produced) expect(member).not.toBe('');
    }
  });

  it('is sorted, so the generated document does not churn', () => {
    const carriers = wonderlandWireCarrierFields();
    const keys = carriers.map((c) => `${c.cppStruct}.${c.field}`);
    expect(keys).toEqual([...keys].sort());
    const enums = wonderlandWireEnums().map((e) => e.cppEnum);
    expect(enums).toEqual([...enums].sort());
  });

  it('names its three decode rules and no fourth', () => {
    expect([...WONDERLAND_WIRE_DECODE_RULES]).toEqual(['direct', 'absence_carrier', 'enum_token']);
  });
});

describe('the committed document is the contract', () => {
  it('matches what the contract renders right now', () => {
    const onDisk = readFileSync(join(process.cwd(), WONDERLAND_WIRE_CONTRACT_PATH), 'utf8');
    expect(
      onDisk,
      'the wire contract is stale — run `npm run wonderland:wire:export` and READ the diff',
    ).toBe(renderWonderlandWireContract(wonderlandWireContract()));
  });

  it('says out loud that it claims nothing about Unreal', () => {
    // The document is read by a session with an engine in front of it, which is
    // exactly the moment a hedge gets dropped. It is generated, so the sentence
    // cannot be edited away without this failing.
    const onDisk = readFileSync(join(process.cwd(), WONDERLAND_WIRE_CONTRACT_PATH), 'utf8');
    expect(onDisk).toContain('no engine has run');
    expect(onDisk).toContain('GENERATED');
  });
});
