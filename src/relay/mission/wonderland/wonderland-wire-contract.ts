import {
  WONDERLAND_CPP_ENUM_PARITY,
  WONDERLAND_CPP_NULLABLE_CARRIERS,
  WONDERLAND_CPP_STRUCT_PARITY,
  WONDERLAND_NULLABLE_FIELDS,
} from './wonderland-contracts';
import {
  WONDERLAND_INTEGRATION_CPP_ENUM_PARITY,
  WONDERLAND_INTEGRATION_CPP_STRUCT_PARITY,
  WONDERLAND_INTEGRATION_NULLABLE_FIELDS,
} from './wonderland-integration-parity';

/**
 * WHAT A CLIENT MUST DO TO JSON BEFORE IT IS A USTRUCT.
 *
 * `Wonderland.Build.cs` has depended on `Json` and `JsonUtilities` since the
 * module existed and NO C++ FILE USES THEM. The decode is unwritten, and the
 * reason it is worth writing this down first is that the wire shape and the
 * USTRUCT shape do not correspond one to one — in two specific places, both of
 * which fail QUIETLY.
 *
 *   ABSENCE. TypeScript has `null`; Unreal's numerics, strings and bools do
 *   not. So every nullable field crosses as a plain JSON value or `null` and
 *   lands in a CARRIER — `FWonderlandText`, `FWonderlandNumber`,
 *   `FWonderlandFlag` — each of which is `{ bKnown, Value }`. A decoder that
 *   maps by name alone puts nothing in either field, and a zero-filled carrier
 *   reads as "Relay did not say" for a value Relay very much did say. Unknown
 *   swallowing a real figure is the exact failure the carriers exist to
 *   prevent, arriving at the one boundary the carriers cannot defend by
 *   themselves.
 *
 *   VOCABULARY. Relay's tokens are `snake_case` or `SCREAMING_SNAKE`; Unreal's
 *   members are `PascalCase`. `independent_review` is not
 *   `EWonderlandJuliusState::IndependentReview` to anything comparing strings.
 *   An unmatched member leaves the ordinal at 0, and ordinal 0 in every
 *   nullable-mirroring enum here is `Unobserved` — so a decoder that gets this
 *   wrong produces a world where Relay appears to be reporting nothing, rather
 *   than one that visibly fails.
 *
 * THIS MODULE IS DERIVED, NOT DECLARED. Every list below is computed from the
 * same parity tables `wonderland-cpp-parity.test.ts` enforces against the real
 * headers. So it cannot describe a field the headers do not have, or miss one
 * they do, without that test failing first — which is the only way a document
 * about a contract stays true to it.
 *
 * WHAT IT DOES NOT CLAIM. Nothing here says what any Unreal API does. No engine
 * has run in this environment and none of this was checked against one. It says
 * what the two SHAPES are and where they differ; what a decoder does about it
 * is the engine session's to write and to prove.
 */

export const WONDERLAND_WIRE_CONTRACT_VERSION = 'relay-wonderland-wire.v1' as const;

/** How one field crosses. Two of the four need code a name-mapper will not write. */
export const WONDERLAND_WIRE_DECODE_RULES = [
  /** Same shape both sides. A name mapping is all it needs. */
  'direct',
  /**
   * JSON value or `null` -> a carrier struct. THE DECODER MUST SET `bKnown`.
   * Absent, `null`, and a real value are three inputs and only two of them
   * mean the same thing.
   */
  'absence_carrier',
  /**
   * A Relay token -> a C++ enum member, by `wonderlandCppEnumMember`. An
   * unmatched token must leave the zero member, which every nullable-mirroring
   * enum here names `Unobserved`.
   */
  'enum_token',
] as const;
export type WonderlandWireDecodeRule = (typeof WONDERLAND_WIRE_DECODE_RULES)[number];

/**
 * A C++ enum member name for a Relay token.
 *
 * `independent_review` -> `IndependentReview`, `PROMPT_ARCHITECT` ->
 * `PromptArchitect`, `game_3d_shooter` -> `Game3dShooter`. Underscores split,
 * each part gets one capital, and a part that is already mixed case keeps its
 * tail — so `bKnown`-style tokens are not mangled if one ever appears.
 *
 * THE DIRECTION IS THE POINT. The parity suite compares both sides by
 * normalising each to a common token, which proves they AGREE; a decoder needs
 * to PRODUCE one from the other, and only this direction tells it how.
 */
export function wonderlandCppEnumMember(token: string): string {
  return token
    // ANY run of non-alphanumerics separates. Relay's vocabularies are not all
    // snake_case: `PROVENANCES` holds `LIVE LOCAL` with a SPACE, and splitting
    // on underscores alone produced `Live local` — a member no header declares,
    // which a decoder would have left at ordinal 0. Found by the directional
    // check in the parity suite the first time it ran.
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) =>
      part.toUpperCase() === part
        ? part.charAt(0) + part.slice(1).toLowerCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
}

/* -------------------------------------------------------- the carriers */

export interface WonderlandWireCarrierField {
  readonly cppStruct: string;
  readonly tsInterface: string;
  /** The JSON key, which is the TypeScript field name. */
  readonly field: string;
}

const STRUCT_PARITY = [
  ...WONDERLAND_CPP_STRUCT_PARITY,
  ...WONDERLAND_INTEGRATION_CPP_STRUCT_PARITY,
];

const NULLABLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  ...WONDERLAND_NULLABLE_FIELDS,
  ...WONDERLAND_INTEGRATION_NULLABLE_FIELDS,
};

/**
 * Every field that crosses as a value-or-null and lands in a carrier.
 *
 * Sorted so the list is stable between runs — a generated document that
 * reordered itself would show a diff on every export and nobody would read it.
 */
export function wonderlandWireCarrierFields(): readonly WonderlandWireCarrierField[] {
  const out: WonderlandWireCarrierField[] = [];
  for (const entry of STRUCT_PARITY) {
    for (const field of NULLABLE_FIELDS[entry.cppStruct] ?? []) {
      out.push(Object.freeze({
        cppStruct: entry.cppStruct,
        tsInterface: entry.tsInterface,
        field,
      }));
    }
  }
  return Object.freeze(
    out.sort((a, b) => a.cppStruct.localeCompare(b.cppStruct) || a.field.localeCompare(b.field)),
  );
}

/* ----------------------------------------------------------- the enums */

export interface WonderlandWireEnum {
  readonly cppEnum: string;
  /** The TypeScript constant the members come from. */
  readonly source: string;
  /** Whether a Relay null is expressible, and therefore whether 0 is reachable. */
  readonly nullable: boolean;
  readonly zeroMember: string;
  /** Wire token -> C++ member, for every member. */
  readonly members: readonly { readonly token: string; readonly cppMember: string }[];
}

const ENUM_PARITY = [
  ...WONDERLAND_CPP_ENUM_PARITY,
  ...WONDERLAND_INTEGRATION_CPP_ENUM_PARITY,
];

/** Every enum that crosses, with the token mapping a decoder has to implement. */
export function wonderlandWireEnums(): readonly WonderlandWireEnum[] {
  return Object.freeze(
    [...ENUM_PARITY]
      .sort((a, b) => a.cppEnum.localeCompare(b.cppEnum))
      .map((entry) =>
        Object.freeze({
          cppEnum: entry.cppEnum,
          source: entry.source,
          nullable: entry.nullable,
          zeroMember: entry.zeroMember,
          members: Object.freeze(
            entry.members.map((token: string) =>
              Object.freeze({ token, cppMember: wonderlandCppEnumMember(token) }),
            ),
          ),
        }),
      ),
  );
}

/* ----------------------------------------------------------- the totals */

export interface WonderlandWireContract {
  readonly schemaVersion: typeof WONDERLAND_WIRE_CONTRACT_VERSION;
  readonly carriers: readonly WonderlandWireCarrierField[];
  readonly carrierTypes: readonly string[];
  readonly enums: readonly WonderlandWireEnum[];
  /** Structs that cross whole. A decoder needs one branch for each. */
  readonly structs: readonly { readonly cppStruct: string; readonly tsInterface: string }[];
}

export function wonderlandWireContract(): WonderlandWireContract {
  return Object.freeze({
    schemaVersion: WONDERLAND_WIRE_CONTRACT_VERSION,
    carriers: wonderlandWireCarrierFields(),
    carrierTypes: Object.freeze([...WONDERLAND_CPP_NULLABLE_CARRIERS]),
    enums: wonderlandWireEnums(),
    structs: Object.freeze(
      [...STRUCT_PARITY]
        .sort((a, b) => a.cppStruct.localeCompare(b.cppStruct))
        .map((entry) =>
          Object.freeze({ cppStruct: entry.cppStruct, tsInterface: entry.tsInterface })),
    ),
  });
}
