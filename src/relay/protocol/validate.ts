import { relayError, type RelayError, type RelayResult, ok, fail } from './errors';
import { checkFreeId, checkId, checkVersionNumber, type IdPrefix } from './ids';

/**
 * Hand-rolled composable validation kit (repo convention — no schema
 * dependency; ADR-009). A Check inspects one field and returns error
 * strings. `objectOf` rejects unknown keys (documented strictness policy):
 * unknown external data survives ONLY inside an explicitly designated
 * `metadata` field. Hidden-reasoning fields are rejected wherever
 * `rejectHiddenReasoning` is applied (report payloads).
 */

export type Check = (value: unknown, field: string) => string[];

const err = (field: string, msg: string) => [`\`${field}\` ${msg}`];

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const str =
  (opts: { allowEmpty?: boolean; max?: number } = {}): Check =>
  (v, f) => {
    if (typeof v !== 'string') return err(f, 'must be a string.');
    if (!opts.allowEmpty && v.trim() === '') return err(f, 'must not be empty.');
    if (opts.max && v.length > opts.max) return err(f, `must be ≤ ${opts.max} chars.`);
    return [];
  };

export const iso = (): Check => (v, f) => {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    return err(f, 'must be an ISO-8601 timestamp.');
  }
  return [];
};

export const num =
  (opts: { int?: boolean; min?: number } = {}): Check =>
  (v, f) => {
    if (typeof v !== 'number' || Number.isNaN(v)) return err(f, 'must be a number.');
    if (opts.int && !Number.isInteger(v)) return err(f, 'must be an integer.');
    if (opts.min !== undefined && v < opts.min) return err(f, `must be ≥ ${opts.min}.`);
    return [];
  };

export const bool = (): Check => (v, f) => (typeof v === 'boolean' ? [] : err(f, 'must be a boolean.'));

export const lit =
  (...values: readonly string[]): Check =>
  (v, f) =>
    typeof v === 'string' && values.includes(v) ? [] : err(f, `must be one of: ${values.join(', ')}.`);

export const id =
  (prefix: IdPrefix): Check =>
  (v, f) => {
    const e = checkId(v, prefix, f);
    return e ? e.details ?? [e.message] : [];
  };

export const freeId = (): Check => (v, f) => {
  const e = checkFreeId(v, f);
  return e ? [e.message] : [];
};

export const versionNum = (): Check => (v, f) => {
  const e = checkVersionNumber(v, f);
  return e ? [e.message] : [];
};

export const arr =
  (item: Check, opts: { minLen?: number } = {}): Check =>
  (v, f) => {
    if (!Array.isArray(v)) return err(f, 'must be an array.');
    if (opts.minLen !== undefined && v.length < opts.minLen) {
      return err(f, `must contain at least ${opts.minLen} item(s).`);
    }
    return v.flatMap((item_, i) => item(item_, `${f}[${i}]`));
  };

/** Free-form metadata: any JSON object — the ONLY place unknown external
 * data may be preserved. */
export const metadata = (): Check => (v, f) => (isRecord(v) ? [] : err(f, 'must be an object.'));

export interface Shape {
  required: Record<string, Check>;
  optional?: Record<string, Check>;
}

export const objectOf =
  (shape: Shape): Check =>
  (v, f) => {
    if (!isRecord(v)) return err(f, 'must be an object.');
    const errors: string[] = [];
    for (const [key, check] of Object.entries(shape.required)) {
      if (!(key in v) || v[key] === undefined || v[key] === null) {
        errors.push(`\`${f}.${key}\` is required.`);
      } else {
        errors.push(...check(v[key], `${f}.${key}`));
      }
    }
    for (const [key, check] of Object.entries(shape.optional ?? {})) {
      if (key in v && v[key] !== undefined && v[key] !== null) {
        errors.push(...check(v[key], `${f}.${key}`));
      }
    }
    const known = new Set([...Object.keys(shape.required), ...Object.keys(shape.optional ?? {})]);
    for (const key of Object.keys(v)) {
      if (!known.has(key)) errors.push(`\`${f}.${key}\` is not a recognized field (strict schema).`);
    }
    return errors;
  };

/** Denylist for hidden-reasoning fields on untrusted external payloads. */
const HIDDEN_REASONING_KEYS = /^(reasoning|chain_?of_?thought|thoughts|internal_?monologue|scratchpad|hidden.*)$/i;

export function rejectHiddenReasoning(v: unknown, field: string): string[] {
  if (!isRecord(v)) return [];
  const errors: string[] = [];
  for (const key of Object.keys(v)) {
    if (HIDDEN_REASONING_KEYS.test(key)) {
      errors.push(`\`${field}.${key}\` is rejected — hidden reasoning is never accepted or stored.`);
    } else if (isRecord(v[key]) && key !== 'metadata') {
      errors.push(...rejectHiddenReasoning(v[key], `${field}.${key}`));
    }
  }
  return errors;
}

/** Run a Check as a RelayResult with a typed cast on success. */
export function validate<T>(
  value: unknown,
  check: Check,
  what: string,
  code: RelayError['code'] = 'validation-failed',
): RelayResult<T> {
  const errors = check(value, what);
  if (errors.length > 0) {
    return fail(relayError(code, `${what} failed validation.`, { details: errors }));
  }
  return ok(value as T);
}
