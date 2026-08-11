import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  OFFICIAL_RELAY_DOG_HEIGHT,
  OFFICIAL_RELAY_DOG_WIDTH,
} from '../../shared/official-relay-dog-sprite';
import {
  WONDERLAND_CPP_ENUM_PARITY,
  WONDERLAND_CPP_NULLABLE_CARRIERS,
  WONDERLAND_CPP_STRUCT_PARITY,
  WONDERLAND_CPP_UNOBSERVED_MEMBER,
  WONDERLAND_DOG_MOTIONS,
  WONDERLAND_MOTION_ANIMATION,
  WONDERLAND_NULLABLE_FIELDS,
} from './wonderland-contracts';

/**
 * WONDERLAND — TypeScript ↔ C++ parity.
 *
 * The direction's most important requirement: a field the C++ side reads must
 * exist in the TS projection and vice versa, and a test must fail when the two
 * drift. This is the second of two mechanically checked links. The first is in
 * `wonderland-contracts.ts`, where every field manifest is built by `exactKeys`
 * and `tsc` rejects it the moment it stops being exactly its interface's keys —
 * without that link, this file would compare the headers against a manifest that
 * had itself drifted, and report agreement.
 *
 * WHY IT PARSES TEXT. Unreal headers are not importable from Node, and there is
 * no build here to reflect over (no engine binary exists in this environment).
 * `docs/documentation-contract.test.ts` and `relay-bridge/env-example-contract.test.ts`
 * set the precedent for reading a non-TypeScript artefact as text; the risk that
 * comes with it is a regex that matches nothing and calls the empty result
 * agreement, so EVERY check below proves its own preconditions first: the file
 * exists, the struct was found, and the parsed field count is the expected one.
 *
 * BIDIRECTIONAL BY CONSTRUCTION. A struct or enum in the headers that is absent
 * from the parity table fails here; an allowlist entry naming something the
 * headers do not declare fails here too. Both directions, following
 * `UNMOUNTED_WEBSITE_SURFACES` in `scripts/relay-surface-parity.mjs`, whose
 * `stale-unmounted-record` and `unused-unmounted-record` rules exist because a
 * record that only ever grows is a record of intentions.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CPP_DIR_RELATIVE = join('wonderland', 'Source', 'Wonderland');
const CPP_DIR = join(ROOT, CPP_DIR_RELATIVE);

/* ------------------------------------------------------------ allowlists */

/**
 * C++ structs with no TypeScript counterpart, and why each is legitimate.
 *
 * Every entry is checked in BOTH directions: the struct must exist in the
 * headers, and it must NOT also appear in the parity table.
 */
const CPP_ONLY_STRUCTS: Readonly<Record<string, string>> = {
  FWonderlandText:
    'carries a nullable string. TypeScript has null; FString has only emptiness, and an empty string is a string.',
  FWonderlandNumber:
    'carries a nullable number. Unreal numerics cannot be null, so absence needs its own flag.',
  FWonderlandFlag:
    'carries a nullable boolean. false is an answer; this struct can say there was none.',
  FWonderlandLinkStatus:
    'the client\'s relationship to the Bridge. Transport state, not world content — Relay never sends it, so it has no projection field.',
  FWonderlandDogProportions:
    'the identity constants a renderer needs at build time. Read back from the skin, never authored in C++.',
  FWonderlandHubZone:
    'a hub-level authoring description. Level layout is Unreal\'s own business and Relay holds no opinion about it.',
};

/**
 * C++ enums with no TypeScript counterpart.
 */
const CPP_ONLY_ENUMS: Readonly<Record<string, string>> = {
  EWonderlandLinkState:
    'pairing/expiry/refusal states of the Bridge link. Relay does not model the client\'s socket, so there is nothing to mirror.',
  EWonderlandHubZoneKind:
    'hub-level authoring vocabulary. Purely presentational, and deliberately not part of the contract.',
};

/**
 * Nullable TS fields whose absence is carried by something other than an
 * approved carrier type, with the mechanism named.
 *
 * Checked in both directions: the field must be nullable in TypeScript (so a
 * field that stopped being nullable makes the exemption unused), and the struct
 * must exist.
 */
const NULL_CARRIER_EXEMPTIONS: readonly {
  readonly cppStruct: string;
  readonly field: string;
  readonly reason: string;
}[] = [
  {
    cppStruct: 'FWonderlandFigure',
    field: 'value',
    reason:
      'the struct IS the carrier: bKnown sits beside Value, so wrapping Value in another carrier would duplicate the flag it already has.',
  },
  {
    cppStruct: 'FWonderlandWorld',
    field: 'gve',
    reason:
      'absence is EWonderlandGvePhase::Unavailable, which is that enum\'s ordinal 0 — so a zero-filled FWonderlandGve already reads as "no experience".',
  },
];

/* --------------------------------------------------------------- parsing */

/** Strip block and line comments. Headers here contain no string literals. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

interface ParsedField {
  readonly cppName: string;
  readonly cppType: string;
  readonly hasInitializer: boolean;
}

interface ParsedStruct {
  readonly name: string;
  readonly fields: readonly ParsedField[];
}

const USTRUCT_PATTERN = /USTRUCT\s*\([^)]*\)\s*struct\s+(\w+)\s*(?::[^{]*)?\{([^{}]*)\}\s*;/g;
const UPROPERTY_PATTERN =
  /UPROPERTY\s*\([^)]*\)\s*([\w:]+(?:\s*<[^;>]*>)?)\s+(\w+)\s*(=[^;]*)?;/g;

function parseStructs(source: string): ParsedStruct[] {
  const clean = stripComments(source);
  const structs: ParsedStruct[] = [];
  for (const match of clean.matchAll(USTRUCT_PATTERN)) {
    const [, name, body] = match;
    const fields: ParsedField[] = [];
    for (const field of body.matchAll(UPROPERTY_PATTERN)) {
      fields.push({
        cppType: field[1].replace(/\s+/g, ''),
        cppName: field[2],
        hasInitializer: field[3] !== undefined,
      });
    }
    structs.push({ name, fields });
  }
  return structs;
}

const UENUM_PATTERN = /UENUM\s*\([^)]*\)\s*enum\s+class\s+(\w+)\s*:\s*\w+\s*\{([^{}]*)\}\s*;/g;

function parseEnums(source: string): Map<string, string[]> {
  const clean = stripComments(source);
  const enums = new Map<string, string[]>();
  for (const match of clean.matchAll(UENUM_PATTERN)) {
    const [, name, body] = match;
    const members = body
      .split(',')
      .map((entry) => entry.trim().split(/[\s=]/)[0])
      .filter((entry) => entry.length > 0);
    enums.set(name, members);
  }
  return enums;
}

/* ------------------------------------------------------------ normalizers */

/**
 * A C++ field name as its TypeScript counterpart.
 *
 * Two rules only: strip Unreal's boolean `b` prefix when it precedes a capital,
 * then lowercase the first character. Deliberately not clever — an ambiguous
 * mapping is caught by the uniqueness check below rather than guessed at.
 */
export function cppFieldToTsName(cppName: string): string {
  const stripped = /^b[A-Z]/.test(cppName) ? cppName.slice(1) : cppName;
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

/**
 * One canonical token for an enum member, whichever side it came from.
 *
 * Handles the two shapes that actually occur: PascalCase on the C++ side,
 * snake_case or SPACE SEPARATED CAPS on the TypeScript side. Digits get their own
 * boundary so `Game3dShooter` and `game_3d_shooter` agree — without that rule
 * they normalize to `game3d_shooter` and `game_3d_shooter` and the test reports a
 * drift that is not one.
 */
export function canonicalEnumToken(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Za-z])([0-9])/g, '$1_$2')
    .replace(/([0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/* ----------------------------------------------------------- the sources */

const headerFiles = existsSync(CPP_DIR)
  ? readdirSync(CPP_DIR).filter((file) => file.endsWith('.h')).sort()
  : [];

const headerSource = headerFiles
  .map((file) => readFileSync(join(CPP_DIR, file), 'utf8'))
  .join('\n');

const parsedStructs = parseStructs(headerSource);
const structByName = new Map(parsedStructs.map((struct) => [struct.name, struct]));
const parsedEnums = parseEnums(headerSource);

/* ------------------------------------------------------- preconditions */

describe('the C++ side is present and readable', () => {
  it('the module directory exists and carries headers', () => {
    expect(existsSync(CPP_DIR), `${CPP_DIR_RELATIVE} does not exist`).toBe(true);
    expect(headerFiles.length, 'no .h files to compare against').toBeGreaterThan(0);
  });

  it('every Wonderland source file is tracked by git', () => {
    // The repository's scanners enumerate via `git ls-files` and cannot see an
    // untracked file. A header added but never `git add -N`'d would make every
    // check below compare against nothing, so the omission is named here rather
    // than discovered as a silent pass.
    const tracked = new Set(
      execFileSync('git', ['ls-files', 'wonderland'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
    );
    const sources = readdirSync(CPP_DIR).filter(
      (file) => file.endsWith('.h') || file.endsWith('.cpp'),
    );
    const untracked = sources
      .map((file) => `${CPP_DIR_RELATIVE}/${file}`)
      .filter((path) => !tracked.has(path));
    expect(
      untracked,
      'these C++ sources are untracked, so `git ls-files` scanners cannot see them — run `git add -N` on them',
    ).toEqual([]);
  });

  it('the parsers found every struct and enum the table names', () => {
    const missingStructs = WONDERLAND_CPP_STRUCT_PARITY.filter(
      (entry) => !structByName.has(entry.cppStruct),
    ).map((entry) => entry.cppStruct);
    expect(missingStructs, 'declared in the parity table, absent from the headers').toEqual([]);

    const missingEnums = WONDERLAND_CPP_ENUM_PARITY.filter(
      (entry) => !parsedEnums.has(entry.cppEnum),
    ).map((entry) => entry.cppEnum);
    expect(missingEnums, 'declared in the parity table, absent from the headers').toEqual([]);
  });

  it('every parsed struct has at least one field', () => {
    // A regex that matched a struct but no UPROPERTY would report perfect
    // agreement for an empty set.
    const empty = parsedStructs.filter((struct) => struct.fields.length === 0).map((s) => s.name);
    expect(empty, 'parsed with zero UPROPERTY fields — the parser or the header is wrong').toEqual(
      [],
    );
  });

  it('every parsed enum has at least one member', () => {
    const empty = [...parsedEnums.entries()]
      .filter(([, members]) => members.length === 0)
      .map(([name]) => name);
    expect(empty, 'parsed with zero members').toEqual([]);
  });
});

/* --------------------------------------------------------- struct parity */

describe('every document struct matches its TypeScript interface', () => {
  it('field names agree in both directions', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_STRUCT_PARITY) {
      const struct = structByName.get(entry.cppStruct);
      if (!struct) continue; // named by the precondition test above
      const cppNames = struct.fields.map((field) => cppFieldToTsName(field.cppName));
      const expected = [...entry.fields].sort();
      const actual = [...cppNames].sort();
      for (const name of expected) {
        if (!actual.includes(name)) {
          offenders.push(`${entry.cppStruct} is missing ${entry.tsInterface}.${name}`);
        }
      }
      for (const name of actual) {
        if (!expected.includes(name)) {
          offenders.push(`${entry.cppStruct}.${name} has no field in ${entry.tsInterface}`);
        }
      }
    }
    expect(
      offenders,
      'the C++ world state and the TypeScript projection disagree about their fields',
    ).toEqual([]);
  });

  it('field counts match, so a duplicate cannot hide a missing field', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_STRUCT_PARITY) {
      const struct = structByName.get(entry.cppStruct);
      if (!struct) continue;
      if (struct.fields.length !== entry.fields.length) {
        offenders.push(
          `${entry.cppStruct} has ${struct.fields.length} fields, ${entry.tsInterface} has ${entry.fields.length}`,
        );
      }
    }
    expect(offenders, 'a set comparison alone cannot see a duplicated field name').toEqual([]);
  });

  it('no two C++ fields normalize to the same TypeScript name', () => {
    const offenders: string[] = [];
    for (const struct of parsedStructs) {
      const seen = new Map<string, string>();
      for (const field of struct.fields) {
        const normalized = cppFieldToTsName(field.cppName);
        const previous = seen.get(normalized);
        if (previous !== undefined) {
          offenders.push(`${struct.name}: ${previous} and ${field.cppName} both mean ${normalized}`);
        }
        seen.set(normalized, field.cppName);
      }
    }
    expect(offenders, 'an ambiguous name mapping would let a real drift look like agreement').toEqual(
      [],
    );
  });

  it('every C++ struct is either mirrored or recorded as C++-only', () => {
    const mirrored = new Set(WONDERLAND_CPP_STRUCT_PARITY.map((entry) => entry.cppStruct));
    const unaccounted = parsedStructs
      .map((struct) => struct.name)
      .filter((name) => !mirrored.has(name) && CPP_ONLY_STRUCTS[name] === undefined);
    expect(
      unaccounted,
      'add these to the parity table, or to CPP_ONLY_STRUCTS with the reason they have no TypeScript counterpart',
    ).toEqual([]);
  });

  it('every C++-only struct record still describes something real', () => {
    const mirrored = new Set(WONDERLAND_CPP_STRUCT_PARITY.map((entry) => entry.cppStruct));
    const stale = Object.keys(CPP_ONLY_STRUCTS).filter((name) => !structByName.has(name));
    const contradictory = Object.keys(CPP_ONLY_STRUCTS).filter((name) => mirrored.has(name));
    expect(stale, 'CPP_ONLY_STRUCTS names structs the headers no longer declare').toEqual([]);
    expect(
      contradictory,
      'CPP_ONLY_STRUCTS names structs that ARE mirrored — the exemption has stopped being true',
    ).toEqual([]);
  });
});

/* ----------------------------------------------------------- enum parity */

describe('every enum matches its Relay vocabulary', () => {
  it('members agree in both directions', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_ENUM_PARITY) {
      const members = parsedEnums.get(entry.cppEnum);
      if (!members) continue;
      const expected = new Set(entry.members.map(canonicalEnumToken));
      if (entry.nullable) expected.add(canonicalEnumToken(WONDERLAND_CPP_UNOBSERVED_MEMBER));
      const actual = new Set(members.map(canonicalEnumToken));
      for (const token of expected) {
        if (!actual.has(token)) offenders.push(`${entry.cppEnum} is missing ${token} (${entry.source})`);
      }
      for (const token of actual) {
        if (!expected.has(token)) offenders.push(`${entry.cppEnum}.${token} is in no Relay vocabulary`);
      }
    }
    expect(offenders, 'the C++ enums and the Relay vocabularies disagree').toEqual([]);
  });

  it('member counts match, so a duplicate cannot hide a missing member', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_ENUM_PARITY) {
      const members = parsedEnums.get(entry.cppEnum);
      if (!members) continue;
      const expectedCount = entry.members.length + (entry.nullable ? 1 : 0);
      if (members.length !== expectedCount) {
        offenders.push(`${entry.cppEnum} has ${members.length} members, expected ${expectedCount}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ordinal 0 is the value that means "Relay has not said"', () => {
    // Unreal cannot hold a null enum and a default-constructed USTRUCT
    // zero-fills, so whatever sits first is what a renderer sees before
    // anything is assigned. Getting this wrong defeats "unknown is never a
    // default" through initialization semantics rather than through a decision.
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_ENUM_PARITY) {
      const members = parsedEnums.get(entry.cppEnum);
      if (!members || members.length === 0) continue;
      const wanted = canonicalEnumToken(entry.zeroMember);
      const found = canonicalEnumToken(members[0]);
      if (found !== wanted) {
        offenders.push(`${entry.cppEnum} starts at ${found}, must start at ${wanted}`);
      }
    }
    expect(offenders, 'a zero-filled struct would read as an observed fact').toEqual([]);
  });

  it('every nullable vocabulary carries the Unobserved sentinel', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_ENUM_PARITY) {
      const members = parsedEnums.get(entry.cppEnum);
      if (!members) continue;
      const has = members.includes(WONDERLAND_CPP_UNOBSERVED_MEMBER);
      if (entry.nullable && !has) offenders.push(`${entry.cppEnum} mirrors a nullable field without ${WONDERLAND_CPP_UNOBSERVED_MEMBER}`);
      if (!entry.nullable && has) offenders.push(`${entry.cppEnum} carries ${WONDERLAND_CPP_UNOBSERVED_MEMBER} but its TypeScript field is never null`);
    }
    expect(offenders).toEqual([]);
  });

  it('every C++ enum is either mirrored or recorded as C++-only', () => {
    const mirrored = new Set(WONDERLAND_CPP_ENUM_PARITY.map((entry) => entry.cppEnum));
    const unaccounted = [...parsedEnums.keys()].filter(
      (name) => !mirrored.has(name) && CPP_ONLY_ENUMS[name] === undefined,
    );
    expect(unaccounted, 'add these to the enum parity table or to CPP_ONLY_ENUMS').toEqual([]);
  });

  it('every C++-only enum record still describes something real', () => {
    const mirrored = new Set(WONDERLAND_CPP_ENUM_PARITY.map((entry) => entry.cppEnum));
    expect(
      Object.keys(CPP_ONLY_ENUMS).filter((name) => !parsedEnums.has(name)),
      'CPP_ONLY_ENUMS names enums the headers no longer declare',
    ).toEqual([]);
    expect(
      Object.keys(CPP_ONLY_ENUMS).filter((name) => mirrored.has(name)),
      'CPP_ONLY_ENUMS names enums that ARE mirrored',
    ).toEqual([]);
  });
});

/* ----------------------------------------------------- absence carriers */

describe('absence survives the crossing into C++', () => {
  const exemptFor = (cppStruct: string, field: string): string | undefined =>
    NULL_CARRIER_EXEMPTIONS.find(
      (entry) => entry.cppStruct === cppStruct && entry.field === field,
    )?.reason;

  const enumsWithSentinel = new Set(
    [...parsedEnums.entries()]
      .filter(([, members]) => members.includes(WONDERLAND_CPP_UNOBSERVED_MEMBER))
      .map(([name]) => name),
  );

  it('every nullable TypeScript field is carried by a type that can say "absent"', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_STRUCT_PARITY) {
      const struct = structByName.get(entry.cppStruct);
      if (!struct) continue;
      const nullable = WONDERLAND_NULLABLE_FIELDS[entry.cppStruct] ?? [];
      for (const tsField of nullable) {
        if (exemptFor(entry.cppStruct, tsField) !== undefined) continue;
        const field = struct.fields.find((f) => cppFieldToTsName(f.cppName) === tsField);
        if (!field) continue; // reported by the field-parity test
        // The allowed set comes from ONE place. Restating it here is how the
        // contract's stated rule and the enforced rule drift apart.
        const carrierOk =
          (WONDERLAND_CPP_NULLABLE_CARRIERS as readonly string[]).includes(field.cppType) ||
          enumsWithSentinel.has(field.cppType);
        if (!carrierOk) {
          offenders.push(
            `${entry.cppStruct}.${field.cppName} is ${field.cppType}, which cannot express absence for the nullable ${entry.tsInterface}.${tsField}`,
          );
        }
      }
    }
    expect(
      offenders,
      'an FString or a bare bool here hands the renderer an empty value it will present as a fact',
    ).toEqual([]);
  });

  it('every carrier exemption is still needed and still real', () => {
    const offenders: string[] = [];
    for (const exemption of NULL_CARRIER_EXEMPTIONS) {
      if (!structByName.has(exemption.cppStruct)) {
        offenders.push(`${exemption.cppStruct} no longer exists`);
        continue;
      }
      const nullable = WONDERLAND_NULLABLE_FIELDS[exemption.cppStruct] ?? [];
      if (!nullable.includes(exemption.field)) {
        offenders.push(
          `${exemption.cppStruct}.${exemption.field} is no longer nullable in TypeScript — remove the exemption`,
        );
      }
      expect(exemption.reason.length, `${exemption.cppStruct}.${exemption.field} has no reason`).toBeGreaterThan(20);
    }
    expect(offenders, 'an exemption that has stopped being true is a disclosure that has stopped being true').toEqual([]);
  });

  it('every scalar UPROPERTY is explicitly initialized', () => {
    // An uninitialized POD member in a USTRUCT is whatever the allocator left
    // behind. Containers and FString default-construct; bools, numbers and
    // enums do not, and an enum that happens to land on a non-zero ordinal is
    // an invented observation.
    const scalar = /^(bool|int8|int32|int64|uint8|uint32|float|double|E\w+)$/;
    const offenders: string[] = [];
    for (const struct of parsedStructs) {
      for (const field of struct.fields) {
        if (scalar.test(field.cppType) && !field.hasInitializer) {
          offenders.push(`${struct.name}.${field.cppName} (${field.cppType})`);
        }
      }
    }
    expect(offenders, 'these members have no explicit initializer').toEqual([]);
  });
});

/* ------------------------------------------- value parity: the proportions */

describe('the rig is sized from the canonical grid, not from a local constant', () => {
  it('the C++ identity initializers equal the shared sprite module\'s values', () => {
    // A SHAPE check would pass a header that declared GridWidth = 20. The Dog's
    // proportions ARE its identity, so this one compares values.
    const struct = structByName.get('FWonderlandDogProportions');
    expect(struct, 'FWonderlandDogProportions is missing').toBeDefined();

    const initializerOf = (cppName: string): number => {
      const field = struct?.fields.find((entry) => entry.cppName === cppName);
      expect(field, `FWonderlandDogProportions.${cppName} is missing`).toBeDefined();
      const source = readFileSync(join(CPP_DIR, 'WonderlandDogAnimation.h'), 'utf8');
      const match = stripComments(source).match(
        new RegExp(`\\b${cppName}\\s*=\\s*(-?\\d+)`),
      );
      expect(match, `${cppName} has no numeric initializer`).not.toBeNull();
      return Number((match as RegExpMatchArray)[1]);
    };

    expect(initializerOf('GridWidth')).toBe(OFFICIAL_RELAY_DOG_WIDTH);
    expect(initializerOf('GridHeight')).toBe(OFFICIAL_RELAY_DOG_HEIGHT);
    // Rows 0-5 head, 6-10 body, 11-13 legs: the bands must cover the grid
    // exactly, or a rig stretches the Dog to fill the gap.
    expect(
      initializerOf('HeadRowCount') + initializerOf('BodyRowCount') + initializerOf('LegRowCount'),
      'the row bands do not account for every row of the canonical grid',
    ).toBe(OFFICIAL_RELAY_DOG_HEIGHT);
    // Four paws, never three.
    expect(initializerOf('LegCount')).toBe(4);
  });
});

/* -------------------------------------------- behavioural parity: animation */

describe('the C++ animation table matches the TypeScript one', () => {
  const CPP_FILE = 'WonderlandDogAnimation.cpp';
  const source = existsSync(join(CPP_DIR, CPP_FILE))
    ? readFileSync(join(CPP_DIR, CPP_FILE), 'utf8')
    : '';

  const cases = new Map<string, string>();
  for (const match of stripComments(source).matchAll(
    /case\s+EWonderlandDogMotion::(\w+)\s*:\s*return\s+EWonderlandDogAnimation::(\w+)\s*;/g,
  )) {
    cases.set(canonicalEnumToken(match[1]), canonicalEnumToken(match[2]));
  }

  it('the resolver exists and every motion has a case', () => {
    expect(source.length, `${CPP_FILE} is missing or empty`).toBeGreaterThan(0);
    expect(cases.size, 'no case labels parsed — the parser or the file is wrong').toBe(
      WONDERLAND_DOG_MOTIONS.length,
    );
    const missing = WONDERLAND_DOG_MOTIONS.map(canonicalEnumToken).filter(
      (motion) => !cases.has(motion),
    );
    expect(missing, 'motions with no C++ animation case').toEqual([]);
  });

  it('each case returns the same clip the TypeScript map returns', () => {
    const offenders: string[] = [];
    for (const motion of WONDERLAND_DOG_MOTIONS) {
      const expected = canonicalEnumToken(WONDERLAND_MOTION_ANIMATION[motion]);
      const actual = cases.get(canonicalEnumToken(motion));
      if (actual !== expected) {
        offenders.push(`${motion}: C++ returns ${actual ?? 'nothing'}, TypeScript returns ${expected}`);
      }
    }
    expect(
      offenders,
      'the 3D dog and the 2D dog would show different behaviour for the same Relay state',
    ).toEqual([]);
  });

  it('an unobserved motion resolves to Dormant, never to a clip', () => {
    // The one branch that is not a case label, and the one that matters most:
    // absence of an observation is not idle patrol.
    expect(source).toMatch(/EWonderlandDogMotion::Unobserved\s*\)?\s*[\s\S]{0,120}Dormant/);
  });
});

/* ----------------------------------------------------- the normalizers */

describe('the name mappers are themselves correct', () => {
  it('strips Unreal boolean prefixes without eating real names', () => {
    expect(cppFieldToTsName('bKnown')).toBe('known');
    expect(cppFieldToTsName('bAttested')).toBe('attested');
    expect(cppFieldToTsName('MissionId')).toBe('missionId');
    // The trap: a real field beginning with a capital B.
    expect(cppFieldToTsName('BlockingFindingsOpen')).toBe('blockingFindingsOpen');
    expect(cppFieldToTsName('BodyColor')).toBe('bodyColor');
  });

  it('normalizes both enum spellings to one token, digits included', () => {
    expect(canonicalEnumToken('VerifiedComplete')).toBe('verified_complete');
    expect(canonicalEnumToken('verified_complete')).toBe('verified_complete');
    expect(canonicalEnumToken('ProviderCallExhausted')).toBe('provider_call_exhausted');
    expect(canonicalEnumToken('LiveLocal')).toBe('live_local');
    expect(canonicalEnumToken('LIVE LOCAL')).toBe('live_local');
    expect(canonicalEnumToken('Game3dShooter')).toBe('game_3d_shooter');
    expect(canonicalEnumToken('game_3d_shooter')).toBe('game_3d_shooter');
  });

  it('keeps the Unobserved sentinel distinct from Relay\'s own not_observed', () => {
    expect(canonicalEnumToken('Unobserved')).not.toBe(canonicalEnumToken('NotObserved'));
  });
});
