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
  /** Declarations inside the struct with no `UPROPERTY`. Unreal cannot see
   *  them and neither could this parser. */
  readonly unreflected: readonly string[];
  /** The struct's raw body, so the self-check can count `UPROPERTY(` inside
   *  THIS struct rather than across a file that also holds UCLASS members. */
  readonly body: string;
}

/**
 * A BALANCED SCANNER, NOT A REGEX — and the regex had six blind spots.
 *
 * The previous parser was `/UPROPERTY\s*\([^)]*\)\s*…/`. `[^)]*` cannot cross a
 * `)`, so an idiomatic `meta = (DisplayName = "…")` specifier ended the macro
 * match early and the declaration was never parsed at all. An independent review
 * added, invisibly:
 *
 *   UPROPERTY(BlueprintReadOnly, meta = (DisplayName = "Wonderland approved this"))
 *   bool bWonderlandApproved = true;
 *
 * and the whole suite passed. Five more drifts were invisible: a nested template
 * (`TMap<FString, TArray<int32>>`), a plain member with no `UPROPERTY`, a
 * macro-generated field, a backslash line continuation, and an entire new
 * brace-bodied `USTRUCT` (the struct pattern's `[^{}]*` body cannot contain a
 * braced initializer). Because such a field never entered `fields`, the
 * "every scalar is explicitly initialized" check could not see it either — so an
 * uninitialized POD behind a `meta` specifier passed too.
 *
 * A parity test with a parser that misses fields certifies an agreement it never
 * checked. This scanner counts depth instead of matching characters, and
 * `THE SELF-CHECK` below makes the parser prove its own coverage.
 */

/** From `openIndex` (which must be an opener), the index of its match. */
function matchingIndex(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The next index of `token` at or after `from`, or -1. */
const nextIndexOf = (text: string, token: string, from: number): number => text.indexOf(token, from);

/**
 * Split a declaration into type, name and initializer.
 *
 * `=` is found at DEPTH ZERO, so `TMap<FString, TArray<int32>> Field = {}` is not
 * split inside its own template arguments — the case the old regex's `[^;>]*`
 * could not express.
 */
function parseDeclaration(declaration: string): ParsedField | null {
  let depth = 0;
  let eq = -1;
  for (let i = 0; i < declaration.length; i += 1) {
    const ch = declaration[i];
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === '>' || ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (ch === '=' && depth === 0) { eq = i; break; }
  }
  const head = (eq === -1 ? declaration : declaration.slice(0, eq)).trim();
  const nameMatch = /([A-Za-z_]\w*)\s*$/.exec(head);
  if (nameMatch === null) return null;
  const cppName = nameMatch[1];
  const cppType = head.slice(0, head.length - nameMatch[0].length).trim().replace(/\s+/g, '');
  if (cppType === '') return null;
  return { cppType, cppName, hasInitializer: eq !== -1 };
}

/** Every `UPROPERTY(...) <decl>;` inside one struct body. */
function parseUProperties(body: string): ParsedField[] {
  const fields: ParsedField[] = [];
  let cursor = 0;
  for (;;) {
    const macro = nextIndexOf(body, 'UPROPERTY', cursor);
    if (macro === -1) break;
    const open = nextIndexOf(body, '(', macro);
    if (open === -1) break;
    const close = matchingIndex(body, open, '(', ')');
    if (close === -1) break;
    const semi = nextIndexOf(body, ';', close);
    if (semi === -1) break;
    const parsed = parseDeclaration(body.slice(close + 1, semi));
    if (parsed !== null) fields.push(parsed);
    cursor = semi + 1;
  }
  return fields;
}

/**
 * Members declared inside a `USTRUCT` WITHOUT a `UPROPERTY`.
 *
 * A plain C++ member is invisible to Unreal's reflection and was invisible here
 * too, so it could carry a field the TypeScript side has never heard of. Anything
 * left after the macros and `GENERATED_BODY()` are removed, that still looks like
 * a declaration, is reported.
 */
function parseUnreflectedMembers(body: string): string[] {
  let stripped = '';
  let cursor = 0;
  for (;;) {
    const macro = nextIndexOf(body, 'UPROPERTY', cursor);
    if (macro === -1) { stripped += body.slice(cursor); break; }
    const open = nextIndexOf(body, '(', macro);
    const close = open === -1 ? -1 : matchingIndex(body, open, '(', ')');
    const semi = close === -1 ? -1 : nextIndexOf(body, ';', close);
    if (semi === -1) { stripped += body.slice(cursor); break; }
    // `;`-separated, so a declaration in one chunk cannot merge with the next.
    stripped += `${body.slice(cursor, macro)};`;
    cursor = semi + 1;
  }
  /**
   * `GENERATED_BODY()` IS REMOVED BEFORE SPLITTING, and the first version of this
   * function was defeated by that ordering.
   *
   * It filtered entries that `startsWith('GENERATED_BODY')` AFTER splitting on
   * `;` — and `GENERATED_BODY()` carries no semicolon, so every inter-declaration
   * chunk concatenated into ONE entry beginning with it, and that single filter
   * discarded the whole struct's unreflected text. A plain `bool bGhost = true;`
   * injected into a real struct passed. The guard hid what it was written to
   * find, which is the failure mode this whole file exists to prevent, committed
   * inside the fix for it.
   */
  return stripped
    .split(/GENERATED_BODY\s*\(\s*\)/)
    .join(';')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    // A declaration needs a type and a name. `public:` and stray tokens do not.
    .filter((entry) => /^[\w:<>,\s*&]+\s+[A-Za-z_]\w*(\s*=[\s\S]*)?$/.test(entry));
}

function parseStructs(source: string): ParsedStruct[] {
  const clean = stripComments(source);
  const structs: ParsedStruct[] = [];
  let cursor = 0;
  for (;;) {
    const macro = nextIndexOf(clean, 'USTRUCT', cursor);
    if (macro === -1) break;
    const open = nextIndexOf(clean, '(', macro);
    if (open === -1) break;
    const close = matchingIndex(clean, open, '(', ')');
    if (close === -1) break;
    const keyword = clean.indexOf('struct', close);
    if (keyword === -1) break;
    const brace = nextIndexOf(clean, '{', keyword);
    if (brace === -1) break;
    // Balanced, so a braced initializer inside the body does not end the struct.
    const end = matchingIndex(clean, brace, '{', '}');
    if (end === -1) break;
    const header = clean.slice(keyword + 'struct'.length, brace);
    const nameMatch = /([A-Za-z_]\w*)/.exec(header);
    const body = clean.slice(brace + 1, end);
    if (nameMatch !== null) {
      structs.push({
        name: nameMatch[1],
        fields: parseUProperties(body),
        unreflected: parseUnreflectedMembers(body),
        body,
      });
    }
    cursor = end + 1;
  }
  return structs;
}

/**
 * ENUM MEMBERS WITH THEIR REAL ORDINALS.
 *
 * The previous parser did `entry.trim().split(/[\s=]/)[0]` — it threw away
 * everything after `=` — and the ordinal-0 check then read `members[0]`, the
 * FIRST DECLARED NAME. A review gave an enum explicit values:
 *
 *   enum class EWonderlandHealth : uint8 { Unknown = 1, Healthy = 0, … };
 *
 * Ordinal 0 is `Healthy`, and the test named "ordinal 0 is the value that means
 * Relay has not said" passed. That is the invariant the whole zero-fill design
 * rests on, and it was checked by declaration position — a check that reads a
 * token's NAME rather than its VALUE, which is this repository's named precedent.
 */
interface ParsedEnumMember {
  readonly name: string;
  readonly ordinal: number;
  readonly explicit: boolean;
}

function parseEnumMembers(body: string): ParsedEnumMember[] {
  const members: ParsedEnumMember[] = [];
  let next = 0;
  for (const raw of body.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const assigned = /^([A-Za-z_]\w*)\s*=\s*(-?\d+)/.exec(entry);
    if (assigned !== null) {
      const ordinal = Number(assigned[2]);
      members.push({ name: assigned[1], ordinal, explicit: true });
      next = ordinal + 1;
      continue;
    }
    const bare = /^([A-Za-z_]\w*)/.exec(entry);
    if (bare === null) continue;
    members.push({ name: bare[1], ordinal: next, explicit: false });
    next += 1;
  }
  return members;
}

function parseEnums(source: string): Map<string, ParsedEnumMember[]> {
  const clean = stripComments(source);
  const enums = new Map<string, ParsedEnumMember[]>();
  let cursor = 0;
  for (;;) {
    const macro = nextIndexOf(clean, 'UENUM', cursor);
    if (macro === -1) break;
    const open = nextIndexOf(clean, '(', macro);
    if (open === -1) break;
    const close = matchingIndex(clean, open, '(', ')');
    if (close === -1) break;
    const brace = nextIndexOf(clean, '{', close);
    if (brace === -1) break;
    const end = matchingIndex(clean, brace, '{', '}');
    if (end === -1) break;
    const nameMatch = /enum\s+class\s+([A-Za-z_]\w*)/.exec(clean.slice(close, brace));
    if (nameMatch !== null) enums.set(nameMatch[1], parseEnumMembers(clean.slice(brace + 1, end)));
    cursor = end + 1;
  }
  return enums;
}

/** Member NAMES only, for the checks that do not care about ordinals. */
const enumNames = (members: readonly ParsedEnumMember[]): string[] => members.map((m) => m.name);

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
  it('THE SELF-CHECK: the parser sees every UPROPERTY in the header', () => {
    /**
     * THE ASSERTION THAT MAKES A PARITY TEST TRUSTWORTHY.
     *
     * Everything else here compares what the parser FOUND against TypeScript. If
     * the parser silently misses a field, every one of those comparisons agrees
     * about a smaller set and reports agreement. An independent review added a
     * field behind a `meta = (...)` specifier and the whole suite passed.
     *
     * So the parser is made to prove its own coverage: count the raw `UPROPERTY(`
     * occurrences in the header text and require that number to equal the fields
     * parsed. It is free today — the two are equal — and it would have failed on
     * every one of the six blind spots.
     */
    /**
     * PER STRUCT, not per file. The headers also declare `UPROPERTY` members
     * inside UCLASS bodies (the pawn's mesh and camera boom), which are not parity
     * surface — a whole-file count is off by those and says nothing useful.
     * Counting inside each parsed struct's own body is the tight assertion.
     */
    const offenders: string[] = [];
    let parsedTotal = 0;
    for (const struct of structByName.values()) {
      const declared = (struct.body.match(/UPROPERTY\s*\(/g) ?? []).length;
      parsedTotal += struct.fields.length;
      if (struct.fields.length !== declared) {
        offenders.push(
          `${struct.name} declares ${String(declared)} UPROPERTY fields and the parser found ${String(struct.fields.length)}`,
        );
      }
    }
    expect(offenders, 'the parser is not seeing every declared field').toEqual([]);
    // And it found something at all, so a parser that returns nothing cannot
    // pass by agreeing with itself.
    expect(parsedTotal).toBeGreaterThan(100);
  });

  it('THE SELF-CHECK: the parser sees every USTRUCT and UENUM in the header', () => {
    const rawStructs = (stripComments(headerSource).match(/USTRUCT\s*\(/g) ?? []).length;
    const rawEnums = (stripComments(headerSource).match(/UENUM\s*\(/g) ?? []).length;
    // A whole new brace-bodied struct was invisible to the old `[^{}]*` body
    // pattern, which is how an entire struct could carry an authority field.
    expect(structByName.size).toBe(rawStructs);
    expect(parsedEnums.size).toBe(rawEnums);
  });

  it('no USTRUCT carries a member Unreal cannot see', () => {
    /**
     * A plain C++ member with no `UPROPERTY` is invisible to Unreal's reflection
     * AND was invisible to this parser, so it could carry a field the TypeScript
     * side has never heard of — including an authority field. Reported by name
     * rather than ignored.
     */
    const offenders: string[] = [];
    for (const struct of structByName.values()) {
      for (const member of struct.unreflected) {
        offenders.push(`${struct.name}: ${member.replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders, 'these members are invisible to Unreal reflection and to this parser').toEqual([]);
  });

  it('members agree in both directions', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_ENUM_PARITY) {
      const members = parsedEnums.get(entry.cppEnum);
      if (!members) continue;
      const expected = new Set(entry.members.map(canonicalEnumToken));
      if (entry.nullable) expected.add(canonicalEnumToken(WONDERLAND_CPP_UNOBSERVED_MEMBER));
      const actual = new Set(enumNames(members).map(canonicalEnumToken));
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

  it('the member whose VALUE is 0 is the one that means "Relay has not said"', () => {
    /**
     * Unreal cannot hold a null enum and a default-constructed USTRUCT
     * zero-fills, so whatever sits at ordinal 0 is what a renderer sees before
     * anything is assigned. Getting this wrong defeats "unknown is never a
     * default" through initialization semantics rather than through a decision.
     *
     * THIS READ `members[0]` — THE FIRST DECLARED NAME. An independent review
     * gave an enum explicit values (`Unknown = 1, Healthy = 0, …`) and the test
     * passed while ordinal 0 was `Healthy`. A check that reads a token's NAME
     * rather than its VALUE is this repository's named precedent for a guard that
     * certifies what it never inspected.
     */
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_ENUM_PARITY) {
      const members = parsedEnums.get(entry.cppEnum);
      if (!members || members.length === 0) continue;
      const wanted = canonicalEnumToken(entry.zeroMember);
      const atZero = members.find((m) => m.ordinal === 0);
      if (atZero === undefined) {
        offenders.push(`${entry.cppEnum} has no member at ordinal 0`);
        continue;
      }
      const found = canonicalEnumToken(atZero.name);
      if (found !== wanted) {
        offenders.push(`${entry.cppEnum} has ${found} at ordinal 0, must have ${wanted}`);
      }
    }
    expect(offenders, 'a zero-filled struct would read as an observed fact').toEqual([]);
  });

  it('no parity enum assigns explicit ordinals at all', () => {
    /**
     * The cheaper half of the same rule, and it is its own checkable statement:
     * these enums are positional by design, so an explicit `= N` anywhere is a
     * maintainer reaching for a mechanism the design does not use — and it is the
     * mechanism that hid `Healthy` at ordinal 0.
     */
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_ENUM_PARITY) {
      for (const member of parsedEnums.get(entry.cppEnum) ?? []) {
        if (member.explicit) offenders.push(`${entry.cppEnum}.${member.name} = ${String(member.ordinal)}`);
      }
    }
    expect(offenders, 'these assign ordinals explicitly; the design is positional').toEqual([]);
  });

  it('every nullable vocabulary carries the Unobserved sentinel', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_ENUM_PARITY) {
      const members = parsedEnums.get(entry.cppEnum);
      if (!members) continue;
      const has = enumNames(members).includes(WONDERLAND_CPP_UNOBSERVED_MEMBER);
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

/**
 * H4 — THE AUTHORITY BOUNDARY, SWEPT OVER BOTH SIDES.
 *
 * `WONDERLAND.md` claimed: "There is no field in any struct on either side of the
 * seam that could express 'Wonderland approved this.'" The check was
 * `Object.keys(request)` for ONE struct — top level, TypeScript only, and nothing
 * inspected C++ field names at all. An independent review added
 * `wonderlandApproved: boolean` to `WonderlandGve` and `bool bWonderlandApproved
 * = true;` to its C++ mirror and all 98 tests passed.
 *
 * The claim is now made true instead of narrowed: every field name in every parity
 * manifest AND every parsed C++ field is swept, with an allowlist naming the
 * fields where Relay's OWN approval legitimately travels. `verdict` is the reason
 * an allowlist is needed rather than a wider vocabulary — a Reviewer verdict IS an
 * approval, and it is Relay's to state.
 */
const AUTHORITY_WORDS = /approv|authoriz|decision|granted|allow|permit|consent|clearance|accept|confirm|endors|ratif|bless|verdict|signed/i;

/** Fields where an approval word is Relay's own truth crossing the seam. */
const RELAY_OWNED_AUTHORITY_FIELDS: readonly { readonly field: string; readonly reason: string }[] = [
  { field: 'verdict', reason: "the Reviewer's verdict, which Relay owns and Wonderland only displays" },
  { field: 'authority', reason: 'the constant `relay_decides` — it says who decides, which is the opposite of claiming to' },
];

describe('nothing on either side of the seam can express "Wonderland approved this"', () => {
  const allowed = (name: string): string | undefined =>
    RELAY_OWNED_AUTHORITY_FIELDS.find((entry) => entry.field === name)?.reason;

  it('sweeps every TypeScript field name in every parity manifest', () => {
    const offenders: string[] = [];
    for (const entry of WONDERLAND_CPP_STRUCT_PARITY) {
      for (const field of entry.fields) {
        if (AUTHORITY_WORDS.test(field) && allowed(field) === undefined) {
          offenders.push(`${entry.tsInterface}.${field}`);
        }
      }
    }
    expect(offenders, 'these could express an authority Wonderland does not have').toEqual([]);
  });

  it('sweeps every C++ field name the parser found, not just the mirrored ones', () => {
    // A C++-only authority field needs no TypeScript counterpart at all, which is
    // how it would have arrived unnoticed.
    const offenders: string[] = [];
    for (const struct of structByName.values()) {
      for (const field of struct.fields) {
        const ts = cppFieldToTsName(field.cppName);
        if (AUTHORITY_WORDS.test(ts) && allowed(ts) === undefined) {
          offenders.push(`${struct.name}.${field.cppName}`);
        }
      }
    }
    expect(offenders, 'these could express an authority Wonderland does not have').toEqual([]);
  });

  it('sweeps every C++ enum member name too', () => {
    // `EWonderlandSomething::WonderlandApproved` is the same claim in a
    // vocabulary rather than a field.
    const offenders: string[] = [];
    for (const [name, members] of parsedEnums.entries()) {
      for (const member of enumNames(members)) {
        if (/wonderlandapprov|selfapprov/i.test(member)) offenders.push(`${name}::${member}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names a reason for every allowlisted authority field, and uses them all', () => {
    // An allowlist that only grows is a record of intentions. Every entry must be
    // reachable, and every reason must be a sentence somebody wrote.
    const everyField = new Set<string>();
    for (const entry of WONDERLAND_CPP_STRUCT_PARITY) for (const f of entry.fields) everyField.add(f);
    for (const struct of structByName.values()) for (const f of struct.fields) everyField.add(cppFieldToTsName(f.cppName));
    for (const entry of RELAY_OWNED_AUTHORITY_FIELDS) {
      expect(entry.reason.length, `${entry.field} has no reason`).toBeGreaterThan(20);
      expect(everyField.has(entry.field), `${entry.field} is allowlisted but exists nowhere`).toBe(true);
    }
  });
});

describe('absence survives the crossing into C++', () => {
  const exemptFor = (cppStruct: string, field: string): string | undefined =>
    NULL_CARRIER_EXEMPTIONS.find(
      (entry) => entry.cppStruct === cppStruct && entry.field === field,
    )?.reason;

  const enumsWithSentinel = new Set(
    [...parsedEnums.entries()]
      .filter(([, members]) => enumNames(members).includes(WONDERLAND_CPP_UNOBSERVED_MEMBER))
      .map(([name]) => name),
  );

  it('the nullable manifest names exactly the structs the parity table names', () => {
    /**
     * H3: THE MANIFEST IS KEYED BY AN UNVALIDATED STRING.
     *
     * `WONDERLAND_NULLABLE_FIELDS[entry.cppStruct] ?? []` — so a TYPO in a key
     * silently turns the absence-carrier check off for that entire struct, and a
     * nullable Relay value then crosses as a bare `FString` where Unreal hands the
     * renderer an empty string and the world presents it as a fact. An
     * independent review misspelled one key, made the C++ change, and both `tsc`
     * and the whole suite passed. Deleting a struct's entry outright did too.
     *
     * The doc claims a carrier is required for EVERY nullable field. It was
     * required only for fields whose struct had an entry under the exactly-right
     * key. Both directions are checked here, matching the pattern the two
     * allowlists already use.
     */
    const tableStructs = WONDERLAND_CPP_STRUCT_PARITY.map((entry) => entry.cppStruct);
    const manifestKeys = Object.keys(WONDERLAND_NULLABLE_FIELDS);
    const missing = tableStructs.filter((name) => !manifestKeys.includes(name));
    const extra = manifestKeys.filter((name) => !tableStructs.includes(name));
    expect(missing, 'these parity structs have no nullable manifest, so their carrier check is OFF').toEqual([]);
    expect(extra, 'these manifest keys name no struct in the parity table — likely a typo').toEqual([]);
  });

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
