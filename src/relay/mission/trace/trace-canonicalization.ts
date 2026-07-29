/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Deterministic canonical serialization for hashing (PURE).
 *
 * Two objects that MEAN the same thing must produce the same string, and two
 * that differ must not. That is the whole job: the hash chain is only as
 * trustworthy as this function's determinism.
 *
 * Canonicalization version "1" rules:
 *   - object keys sorted recursively (insertion order is never trusted);
 *   - array order preserved (order is meaning);
 *   - explicit `null` preserved;
 *   - `undefined` OBJECT PROPERTIES are omitted — an absent field and a field
 *     set to undefined canonicalize identically. `undefined` inside an ARRAY
 *     is REJECTED, because dropping or nulling a slot would silently change
 *     the array's meaning;
 *   - functions, symbols, `NaN`, `Infinity`, `-Infinity`, and BigInt are
 *     REJECTED. BigInt has no safe JSON representation and no agreed
 *     precision contract, so it is refused rather than silently stringified;
 *   - non-plain objects (class instances, Date, Map, Set, RegExp, typed
 *     arrays) are REJECTED. Timestamps must be normalized to ISO strings
 *     BEFORE event creation, so a Date can never reach the hash.
 *
 * Nothing here reads a clock, mutates its input, or depends on runtime
 * `JSON.stringify` object ordering.
 */

import { traceError, traceFail, traceOk, type TraceResult } from './trace-errors';

function describe(value: unknown): string {
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : String(value);
  if (typeof value === 'bigint') return 'BigInt';
  if (typeof value === 'function') return 'function';
  if (typeof value === 'symbol') return 'symbol';
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const name = (value as object).constructor?.name;
  return name ? `${name} instance` : typeof value;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

class CanonicalizationRejection extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'CanonicalizationRejection';
  }
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new CanonicalizationRejection(path, `non-finite number (${describe(value)})`);
      }
      // Normalize -0 to 0 so two equal numbers never hash differently.
      return JSON.stringify(value === 0 ? 0 : value);
    }
    case 'bigint':
      throw new CanonicalizationRejection(
        path,
        'BigInt has no safe canonical JSON form; convert it to a string before hashing',
      );
    case 'function':
      throw new CanonicalizationRejection(path, 'functions are never serializable into a trace');
    case 'symbol':
      throw new CanonicalizationRejection(path, 'symbols are never serializable into a trace');
    case 'undefined':
      // Reached only inside arrays; object properties are filtered earlier.
      throw new CanonicalizationRejection(
        path,
        'undefined inside an array would silently change the array',
      );
    default:
      break;
  }

  if (Array.isArray(value)) {
    const items = value.map((item, index) => serialize(item, `${path}[${index}]`));
    return `[${items.join(',')}]`;
  }

  const object = value as object;
  if (!isPlainObject(object)) {
    throw new CanonicalizationRejection(
      path,
      `${describe(value)} is not a plain JSON object; normalize it before hashing`,
    );
  }

  const entries = Object.keys(object as Record<string, unknown>)
    .sort()
    .flatMap((key) => {
      const inner = (object as Record<string, unknown>)[key];
      if (inner === undefined) return []; // absent === explicitly undefined
      return [`${JSON.stringify(key)}:${serialize(inner, path ? `${path}.${key}` : key)}`];
    });
  return `{${entries.join(',')}}`;
}

/**
 * Canonicalizes any JSON-safe value, or returns a structured error naming the
 * exact path that failed. Never mutates the input.
 */
export function canonicalSerialize(value: unknown): TraceResult<string> {
  try {
    return traceOk(serialize(value, ''));
  } catch (error) {
    if (error instanceof CanonicalizationRejection) {
      return traceFail(
        traceError(
          'UNSUPPORTED_METADATA_VALUE',
          `${error.path || '<root>'}: ${error.detail}`,
          'replace the value with a JSON-safe representation before recording the event',
          { field: error.path || '<root>' },
        ),
      );
    }
    return traceFail(
      traceError(
        'CANONICALIZATION_FAILED',
        error instanceof Error ? error.message : 'canonical serialization failed',
        'inspect the value for cycles or unsupported structures',
      ),
    );
  }
}

/**
 * The exact bytes an event hash is computed over: the complete envelope with
 * `eventHash` excluded and everything else — including `previousEventHash`,
 * `sequence`, actor, source trust, every identity/revision reference, and the
 * redacted metadata — included.
 */
export function canonicalEventInput(
  event: Record<string, unknown>,
): TraceResult<string> {
  const { eventHash: _excluded, ...hashable } = event;
  return canonicalSerialize(hashable);
}
