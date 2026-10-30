import { ARCHITECT_PLAN_SCHEMA } from './plan-schema';
import type {
  GptEffort, GptFailureClass, GptRunFailure, GptRunOutcome, GptRunRequest, GptRunSuccess, GptUsage,
} from './gpt-runner';

/**
 * THE AGENTIC ARCHITECT ON THE ANTHROPIC MESSAGES API, server-side only.
 *
 * The same contract as `runGptArchitect`: the same request (`instructions`,
 * `input`, an optional answer schema that defaults to the plan schema), the same
 * success and failure shapes, and the same classes the live adapter maps to
 * Julius codes. The caller still parses and validates every answer with the
 * domain's own validators, so nothing about what a valid plan is lives here.
 *
 * Deliberate choices:
 *   - `fetch`, pinned to `https://api.anthropic.com`, `redirect: 'error'`, and
 *     NO RETRY of any kind. One call to this function is at most one request.
 *     Julius alone decides whether to ask again (#43, #479).
 *   - STRUCTURED OUTPUT is `output_config.format` with the shared JSON schema.
 *     Forced `tool_choice` is a 400 on `claude-opus-5-5`, so a forced tool call
 *     is not available. The schema constrains the text block, and the adapter
 *     re-validates it as it does for the GPT path.
 *   - `thinking` is not sent. The model's default applies. The effort is sent
 *     only when the mission declared one, as `output_config.effort`.
 *   - The key goes in `x-api-key` and nowhere else. No message here ever quotes
 *     the provider, the request or the key.
 *
 * REFUSAL EVIDENCE. A non-2xx answer keeps only machine facts: the status, the
 * `error.type` token, the `request-id` header (or why it is unavailable) and the
 * `anthropic-ratelimit-*` counts. The provider's message decides ONE thing, a
 * credit-balance refusal, and otherwise survives only as SANITIZED EVIDENCE
 * (`providerMessage`): a closed category, the `error.details.error_code`
 * token, the full message's UTF-8 byte length and sha256, and a printable-ASCII
 * excerpt of at most 240 characters with key-shaped text, e-mail addresses,
 * URLs, IPs, long digit runs and every 32+ character token redacted. The
 * excerpt is OMITTED (the rest kept) when the message overlaps the prompt or
 * anything credential- or contact-shaped survives redaction. Never the raw body, never a header. Run 40698923582's
 * architect 400 (req_011CgUkJwRQ8wdpL8pi7TMHH) was undiagnosable because the
 * message was dropped; the evidence changes no class, retry or spend decision.
 */

export const ANTHROPIC_PINNED_ORIGIN = 'https://api.anthropic.com';
export const ANTHROPIC_MESSAGES_URL = `${ANTHROPIC_PINNED_ORIGIN}/v1/messages`;
/** The same version the spend-free organization probe sends. */
export const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * `insufficient_credit` is the account's balance refusing the call. It is its
 * own class so it can never be read as a transient fault: it maps to a
 * non-retryable code, and no amount of waiting changes it.
 */
export type AnthropicArchitectFailureClass = GptFailureClass | 'insufficient_credit' | 'architect_schema_unsupported';

/**
 * THE ANSWER SCHEMA, IN THE SUBSET ANTHROPIC STRUCTURED OUTPUTS ACCEPT.
 *
 * Source: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 * ("JSON Schema limitations", read 2026-10-26).
 *   - Supported: the basic types (type arrays count as unions), `enum`, `const`,
 *     `anyOf`, `allOf` (not with `$ref`), local `$ref` / `$defs` / `definitions`,
 *     `default`, `required`, `additionalProperties: false` (required for
 *     objects), the string formats listed below, and `minItems` of 0 or 1.
 *   - Not supported: recursive schemas, external `$ref`, numerical constraints,
 *     `minLength` / `maxLength`, and array constraints beyond `minItems` 0 or 1.
 *     "If you use an unsupported feature, you'll receive a 400 error."
 * The official SDKs strip the unsupported bounds and re-validate client-side;
 * this runner uses raw fetch, so it does the same here, before any request.
 *
 * STRIPPED (a bound Julius already enforces after parse: the domain sanitizers
 * and validators read the answer, never the schema): maxItems, minItems other
 * than 0/1, maxLength, minLength, minimum, maximum, exclusiveMinimum,
 * exclusiveMaximum, multipleOf, uniqueItems, and `pattern`. The docs support
 * simple patterns, but "complex patterns might result in 400 errors", and no
 * architect schema uses one, so none is sent.
 *
 * REFUSED, before any fetch (`architect_schema_unsupported`): anything else,
 * including `additionalProperties` other than false, an object without
 * `additionalProperties: false`, `oneOf` (not listed), `not`, `if`/`then`/`else`,
 * `patternProperties`, `propertyNames`, `prefixItems`, `contains`, an unlisted
 * `format`, an external or unresolvable `$ref`, a recursive `$ref`, and any
 * keyword this function does not know. A schema bug can never be a paid call.
 */
const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
const STRIPPED_BOUNDS = new Set([
  'maxItems', 'maxLength', 'minLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'uniqueItems', 'pattern',
]);
const ANNOTATIONS = new Set(['description', 'title', 'default']);
const BASIC_TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
/** Every keyword the transformed schema may contain. A test walks the real schemas against it. */
export const ANTHROPIC_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', 'allOf',
  '$ref', '$defs', 'definitions', 'format', 'minItems', ...ANNOTATIONS,
]);

export class AnthropicSchemaUnsupported extends Error {
  constructor(readonly keyword: string, readonly at: string) {
    super(`architect_schema_unsupported:${keyword}`);
  }
}

/**
 * `{type: [A, B], ...rest}` AS `{anyOf: [{type: A, ...}, {type: B, ...}]}`.
 *
 * The documentation lists `anyOf` as supported and mentions type arrays only as
 * something counted against the union limit ("Total parameters that use `anyOf`
 * or type arrays (for example, `"type": ["string", "null"]`) across all strict
 * schemas", limit 16). It never lists them as supported, so they are not sent.
 * Each keyword goes to the branch it constrains:
 *   - `properties`, `required`, `additionalProperties` to the object branch;
 *   - `items`, `minItems` and the array bounds to the array branch;
 *   - `format` and the string bounds to the string branch;
 *   - the numeric bounds to the integer/number branch;
 *   - `enum` and `const`, filtered per branch by the JSON type of each value (a
 *     branch whose enum keeps no value is dropped: it could match nothing);
 *   - `description`, `title`, `default` stay on the outer node.
 * Any other keyword is left on the outer node, where the walker refuses it.
 */
const OBJECT_KEYS = new Set(['properties', 'required', 'additionalProperties']);
const ARRAY_KEYS = new Set(['items', 'minItems', 'maxItems', 'uniqueItems']);
const STRING_KEYS = new Set(['format', 'minLength', 'maxLength', 'pattern']);
const NUMBER_KEYS = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']);
const jsonTypeOf = (value: unknown): string => (value === null ? 'null'
  : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number')
    : typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : 'other');
const valueFitsType = (value: unknown, type: string): boolean => {
  const actual = jsonTypeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
};

export function anthropicTypeArrayAsAnyOf(node: Record<string, unknown>, at: string): Record<string, unknown> {
  const types = node.type as unknown[];
  if (types.length === 0 || types.some((entry) => typeof entry !== 'string' || !BASIC_TYPES.has(entry)) || new Set(types).size !== types.length) {
    throw new AnthropicSchemaUnsupported('type', `${at}/type`);
  }
  if ('anyOf' in node) throw new AnthropicSchemaUnsupported('anyOf', `${at}/anyOf`);
  const outer: Record<string, unknown> = {};
  const branches = (types as string[]).map((type) => ({ type } as Record<string, unknown>));
  const branchFor = (type: string): Record<string, unknown> | undefined => branches.find((branch) => branch.type === type);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') continue;
    const owner = OBJECT_KEYS.has(key) ? branchFor('object')
      : ARRAY_KEYS.has(key) ? branchFor('array')
        : STRING_KEYS.has(key) ? branchFor('string')
          : NUMBER_KEYS.has(key) ? (branchFor('number') ?? branchFor('integer'))
            : undefined;
    if (OBJECT_KEYS.has(key) || ARRAY_KEYS.has(key) || STRING_KEYS.has(key) || NUMBER_KEYS.has(key)) {
      // A keyword for a type the union does not include constrains nothing that can occur.
      if (owner !== undefined) owner[key] = value;
      continue;
    }
    if (key === 'enum' || key === 'const') {
      for (const branch of branches) {
        const kept = key === 'enum'
          ? (Array.isArray(value) ? value.filter((entry) => valueFitsType(entry, branch.type as string)) : value)
          : (valueFitsType(value, branch.type as string) ? value : undefined);
        if (key === 'enum') branch.enum = kept;
        else if (kept !== undefined) branch.const = kept;
        else branch.__drop = true;
      }
      continue;
    }
    outer[key] = value;
  }
  const kept = branches.filter((branch) => branch.__drop !== true && !(Array.isArray(branch.enum) && branch.enum.length === 0));
  if (kept.length === 0) throw new AnthropicSchemaUnsupported('enum', `${at}/enum`);
  return { ...outer, anyOf: kept };
}

export function anthropicStructuredOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const root = schema;
  const defsOf = (name: '$defs' | 'definitions'): Record<string, unknown> =>
    (root[name] !== null && typeof root[name] === 'object' && !Array.isArray(root[name]) ? root[name] as Record<string, unknown> : {});
  const refTarget = (ref: string, at: string): { readonly key: string; readonly node: unknown } => {
    const match = /^#\/(\$defs|definitions)\/([A-Za-z0-9_.-]+)$/u.exec(ref);
    if (match === null) throw new AnthropicSchemaUnsupported('$ref', at);
    const node = defsOf(match[1] as '$defs' | 'definitions')[match[2]!];
    if (node === undefined) throw new AnthropicSchemaUnsupported('$ref', at);
    return { key: ref, node };
  };
  const reachesRef = (node: unknown, ref: string, seen: Set<string>): boolean => {
    if (Array.isArray(node)) return node.some((entry) => reachesRef(entry, ref, seen));
    if (node === null || typeof node !== 'object') return false;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string') {
        if (value === ref) return true;
        if (seen.has(value)) continue;
        seen.add(value);
        const target = /^#\/(\$defs|definitions)\/([A-Za-z0-9_.-]+)$/u.exec(value);
        if (target !== null && reachesRef(defsOf(target[1] as '$defs' | 'definitions')[target[2]!], ref, seen)) return true;
      } else if (key !== 'enum' && key !== 'const' && key !== 'default') {
        if (reachesRef(value, ref, seen)) return true;
      }
    }
    return false;
  };
  const walk = (node: unknown, at: string): Record<string, unknown> => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) throw new AnthropicSchemaUnsupported('schema', at);
    // A TYPE ARRAY IS REWRITTEN AS anyOf before anything else is read (see `anthropicTypeArrayAsAnyOf`).
    if (Array.isArray((node as Record<string, unknown>).type)) return walk(anthropicTypeArrayAsAnyOf(node as Record<string, unknown>, at), at);
    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      const here = `${at}/${key}`;
      if (STRIPPED_BOUNDS.has(key)) continue;
      switch (key) {
        case 'type': {
          // A type array never reaches here (it was rewritten above), so the wire only ever carries one type per node.
          if (typeof value !== 'string' || !BASIC_TYPES.has(value)) throw new AnthropicSchemaUnsupported('type', here);
          out.type = value;
          break;
        }
        case 'properties': {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AnthropicSchemaUnsupported('properties', here);
          out.properties = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, walk(sub, `${here}/${name}`)]));
          break;
        }
        case 'required':
          if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new AnthropicSchemaUnsupported('required', here);
          out.required = [...value];
          break;
        case 'additionalProperties':
          if (value !== false) throw new AnthropicSchemaUnsupported('additionalProperties', here);
          out.additionalProperties = false;
          break;
        case 'items':
          out.items = walk(value, here);
          break;
        case 'enum':
          if (!Array.isArray(value) || value.some((entry) => entry !== null && typeof entry === 'object')) throw new AnthropicSchemaUnsupported('enum', here);
          out.enum = [...value];
          break;
        case 'const':
          if (value !== null && typeof value === 'object') throw new AnthropicSchemaUnsupported('const', here);
          out.const = value;
          break;
        case 'anyOf':
        case 'allOf':
          if (!Array.isArray(value) || value.length === 0) throw new AnthropicSchemaUnsupported(key, here);
          if (key === 'allOf' && value.some((entry) => entry !== null && typeof entry === 'object' && '$ref' in (entry as object))) throw new AnthropicSchemaUnsupported('allOf', here);
          out[key] = value.map((entry, index) => walk(entry, `${here}/${index}`));
          break;
        case '$ref': {
          if (typeof value !== 'string') throw new AnthropicSchemaUnsupported('$ref', here);
          const target = refTarget(value, here);
          if (reachesRef(target.node, value, new Set())) throw new AnthropicSchemaUnsupported('recursion', here);
          out.$ref = value;
          break;
        }
        case '$defs':
        case 'definitions':
          if (at !== '#' || value === null || typeof value !== 'object' || Array.isArray(value)) throw new AnthropicSchemaUnsupported(key, here);
          out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, walk(sub, `${here}/${name}`)]));
          break;
        case 'format':
          if (typeof value !== 'string' || !SUPPORTED_FORMATS.has(value)) throw new AnthropicSchemaUnsupported('format', here);
          out.format = value;
          break;
        case 'minItems':
          // Only 0 and 1 are accepted by the API; any other floor is enforced after parse.
          if (value === 0 || value === 1) out.minItems = value;
          break;
        default:
          if (ANNOTATIONS.has(key)) { out[key] = value; break; }
          throw new AnthropicSchemaUnsupported(key, here);
      }
    }
    const isObject = source.type === 'object' || (Array.isArray(source.type) && source.type.includes('object'));
    if (isObject && out.additionalProperties !== false) throw new AnthropicSchemaUnsupported('additionalProperties', at);
    return out;
  };
  return walk(schema, '#');
}

/** The `anthropic-ratelimit-*` counts. Null is "not reported", never zero. */
export interface AnthropicRateLimitEvidence {
  readonly requestsLimit: number | null;
  readonly requestsRemaining: number | null;
  readonly tokensLimit: number | null;
  readonly tokensRemaining: number | null;
  readonly inputTokensLimit: number | null;
  readonly inputTokensRemaining: number | null;
  readonly outputTokensLimit: number | null;
  readonly outputTokensRemaining: number | null;
}

/**
 * THE CLOSED CATEGORY of a provider message. Evidence only: the failure class
 * is decided by `classifyAnthropicStatus` alone, exactly as before.
 *   - `credit_too_low`: the same `credit balance is too low` text the class reads.
 *   - `spend_limit`: "You have reached your specified (workspace) API usage
 *     limits", a 400 `invalid_request_error` (docs: api/rate-limits, "Setting
 *     your own spend limit"). Deliberately NOT a class change.
 *   - `schema_too_complex`: "Schema is too complex for compilation".
 *   - `workspace_header`: a message naming `anthropic-workspace-id`.
 */
export type AnthropicProviderMessageClass = 'spend_limit' | 'credit_too_low' | 'schema_too_complex' | 'workspace_header' | 'other';

/** The provider's message as sanitized evidence. No field is the raw message. */
export interface AnthropicProviderMessageEvidence {
  readonly messageClass: AnthropicProviderMessageClass;
  /** `error.details.error_code` when it is a safe token; null when absent. */
  readonly errorCode: string | null;
  /** True when `error.details.error_code` was present but not a safe token. */
  readonly errorCodeUnusable: boolean;
  /**
   * Printable ASCII, single line, key-shaped text, e-mail addresses, URLs, IP
   * addresses, long digit runs and 32+ character tokens redacted, at most 240
   * characters. NULL when safe redaction cannot be guaranteed: see `excerptOmitted`.
   */
  readonly excerpt: string | null;
  /**
   * Why the excerpt was omitted, or null when it was kept.
   *   - `prompt_overlap`: the message shares a run of text with the request's
   *     system prompt or input, so it may quote prompt contents.
   *   - `unsafe_residue`: after redaction the text still looks like a credential
   *     or contact detail.
   * The category, code, length and digest are kept either way.
   */
  readonly excerptOmitted: 'prompt_overlap' | 'unsafe_residue' | null;
  /** The full message's UTF-8 byte length. */
  readonly messageBytes: number;
  /** The full message's sha256 (lowercase hex, over its UTF-8 bytes). */
  readonly messageSha256: string;
}

export interface AnthropicRefusalEvidence {
  readonly httpStatus: number;
  /** The provider's `error.type`, a safe token, or null when absent or unusable. */
  readonly errorType: string | null;
  /** True when a body was read but its `error.type` was not a safe token. */
  readonly errorTypeUnparseable: boolean;
  readonly requestId: string | null;
  /** Present exactly when `requestId` is null. */
  readonly requestIdUnavailableReason: 'request_id_header_absent' | 'request_id_header_unusable' | null;
  readonly rateLimit: AnthropicRateLimitEvidence;
  /**
   * The provider's message as sanitized evidence. Null when the body was not
   * JSON with an `error` object (or exceeded the evidence bound). Absent from a
   * refusal another runner built.
   */
  readonly providerMessage?: AnthropicProviderMessageEvidence | null;
}

export interface AnthropicArchitectSuccess extends GptRunSuccess {
  readonly providerRequestId: string | null;
  readonly providerRequestUnavailableReason: string | null;
}

export interface AnthropicArchitectFailure extends Omit<GptRunFailure, 'failureClass'> {
  readonly failureClass: AnthropicArchitectFailureClass;
  /** Present when the provider answered with an HTTP error status. */
  readonly refusal?: AnthropicRefusalEvidence;
  readonly providerRequestId?: string | null;
  readonly providerRequestUnavailableReason?: string | null;
}

export type AnthropicArchitectOutcome = AnthropicArchitectSuccess | AnthropicArchitectFailure;

/** What either architect runner may return. The adapter accepts both. */
export type ArchitectRunOutcome = GptRunOutcome | AnthropicArchitectOutcome;
/** THE ONE RUNNER SHAPE the live architect adapter calls. */
export type ArchitectRunner = (request: GptRunRequest) => Promise<ArchitectRunOutcome>;

/** Injectable transport, for offline tests. Production uses the global fetch. */
export interface AnthropicArchitectDeps {
  readonly fetch?: typeof fetch;
}

const SAFE_TOKEN = /^[a-z][a-z0-9_]{0,47}$/u;
const SAFE_REQUEST_ID = /^req_[A-Za-z0-9]{1,60}$/u;
const SAFE_COUNT = /^[0-9]{1,15}$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const CREDIT_TOO_LOW = /credit balance is too low/iu;
const MAX_ERROR_BODY_CHARS = 8_192;
/** How much of an error body the EVIDENCE parse reads. The class still reads only the first 8,192 characters. */
const MAX_ERROR_EVIDENCE_CHARS = 65_536;
export const PROVIDER_MESSAGE_EXCERPT_MAX = 240;
const SPEND_LIMIT = /you have reached your specified (?:workspace )?api usage limits/iu;
const SCHEMA_TOO_COMPLEX = /schema is too complex/iu;
const WORKSPACE_HEADER = /anthropic-workspace-id/iu;
const SAFE_ERROR_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u;
/** Key-shaped text, redacted before the 32+ character rule (some keys are shorter). */
const KEY_SHAPED: readonly RegExp[] = [
  /\b(?:sk|xai|rk|pk)-[A-Za-z0-9_-]{6,}/giu,
  /\bgh[pousr]_[A-Za-z0-9]{6,}/gu,
  /\bgithub_pat_[A-Za-z0-9_]{6,}/gu,
  /\bAKIA[0-9A-Z]{8,}/gu,
  /\bbearer\s+\S+/giu,
  // An authorization value with its scheme (PILOT M1): the scheme AND the credential after it.
  /\b(?:x-api-key|authorization|api[_-]?key)\s*[:=]?\s*(?:(?:basic|bearer|token|digest)\s+)?[^\s,;]+/giu,
  // A bare Basic credential (base64), and a bare Token value that carries a digit (PILOT M1).
  /\bbasic\s+[A-Za-z0-9+/]{6,}={0,2}(?![A-Za-z0-9+/=])/giu,
  /\btoken\s+(?=[A-Za-z0-9+/._=-]*\d)[A-Za-z0-9+/._=-]{6,}/giu,
  /\b(?:token|secret|password|credential)\s*[:=]\s*\S+/giu,
  // A password with no separator (PILOT L3): `password hunter2`, `password is hunter2`.
  /\b(?:password|passwd|passphrase)\s+(?:is\s+)?\S+/giu,
  /-----BEGIN[^-]*-----/gu,
  /\bhttps?:\/\/\S+/giu,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gu,
  // A spelled-out e-mail (PILOT Low): `jane dot roe at example dot com`, `jane[at]example[dot]com`.
  /\b(?:[A-Za-z0-9._%+-]+\s*[[(]?\s*dot\s*[\])]?\s*)*[A-Za-z0-9._%+-]+\s*[[(]?\s*at\s*[\])]?\s*[A-Za-z0-9-]+(?:\s*[[(]?\s*dot\s*[\])]?\s*[A-Za-z0-9-]+)+/giu,
  // IPv6 (PILOT Low): a compressed address (`::`) or four or more colon groups. A clock time has at most two.
  /(?<![0-9a-f:])(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![0-9a-z:])/giu,
  /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/giu,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/gu,
  /\+?\d(?:[ ().\/-]{0,3}\d){8,}/gu,
  // Organization, workspace, user and key identifiers below the 32-character rule (a whole UUID is above it).
  /\b(?:wrkspc|org|user|apikey|acct|key)_[A-Za-z0-9]{4,}/giu,
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/giu,
];
/**
 * Invisible format characters (zero-width space, joiners, word joiner, BOM,
 * soft hyphen, Mongolian vowel separator) are DELETED before any matching, so
 * a key or prompt text interleaved with them is seen whole and redacted or
 * omitted, never kept as `?`-separated letters.
 */
// Skywalker F1: every format character (\p{Cf}) and combining mark (\p{M}), not only the listed ones.
const INVISIBLE = /[\p{Cf}\p{M}\u00ad\u180e\u200b-\u200d\u2060\ufeff]/gu;
const visible = (text: string): string => text.replace(INVISIBLE, '');
/**
 * FOLDED BEFORE MATCHING (PILOT L2): compatibility forms (fullwidth letters)
 * by NFKC, every Unicode dash to `-`, and the Cyrillic and Greek letters that
 * look like ASCII to their ASCII twin, so `\u0455k\u2011ant-...` is `sk-ant-...`
 * to every rule. Only the excerpt is folded; the class reads the raw message.
 */
const DASHES = /[\u2010-\u2015\u2212\u2e3a\u2e3b\ufe58\ufe63\uff0d]/gu;
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0443': 'y', '\u0456': 'i', '\u0458': 'j',
  '\u0455': 's', '\u043a': 'k', '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041a': 'K', '\u041c': 'M', '\u041d': 'H', '\u041e': 'O',
  '\u0420': 'P', '\u0421': 'C', '\u0422': 'T', '\u0425': 'X', '\u0405': 'S', '\u0406': 'I', '\u0408': 'J',
  '\u03bf': 'o', '\u03b1': 'a', '\u03ba': 'k', '\u03c1': 'p', '\u039f': 'O', '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u039a': 'K', '\u03a1': 'P', '\u03a4': 'T', '\u03a7': 'X',
};
const HOMOGLYPH = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'gu');
const folded = (text: string): string => visible(text).normalize('NFKC').replace(DASHES, '-').replace(HOMOGLYPH, (c) => HOMOGLYPHS[c] ?? c);
/** What must not survive redaction; when it does, the excerpt is omitted rather than trusted. */
const UNSAFE_RESIDUE: readonly RegExp[] = [
  /@/u, /\b(?:sk|xai|rk|pk)-/iu, /\bgh[pousr]_/u, /github_pat_/iu, /\bAKIA/u, /-----BEGIN/u, /:\/\//u,
  /\b(?:bearer|password|passwd|secret|token|credential|api[_-]?key|x-api-key|authorization)\b\s*[:=]/iu,
  /\d(?:[^A-Za-z0-9]{0,3}\d){8,}/u,
  /\b(?:wrkspc|org|user|apikey|acct|key)_/iu,
];
/**
 * Only this head of a message is ever sanitized or emitted, ending at the last
 * whitespace inside it so no token is cut part-way. It bounds the regex work
 * (some shapes are quadratic on a long run) and still leaves far more than 240
 * characters to redact before the cut.
 */
const SANITIZE_WINDOW = 1_024;
/** The shortest shared run that counts as quoting the prompt (normalized characters). */
const PROMPT_OVERLAP_WINDOW = 16;
const LONG_TOKEN = /\S{32,}/gu;
const REDACTED = '[redacted]';

const token = (raw: unknown): string | null => (typeof raw === 'string' && SAFE_TOKEN.test(raw) ? raw : null);

/** The request id from the response header, or why it is unavailable. */
export function anthropicRequestId(headers: Headers | null | undefined): {
  readonly requestId: string | null;
  readonly reason: 'request_id_header_absent' | 'request_id_header_unusable' | null;
} {
  const raw = typeof headers?.get === 'function' ? headers.get('request-id') : null;
  if (raw === null || raw.trim() === '') return { requestId: null, reason: 'request_id_header_absent' };
  const value = raw.trim();
  return SAFE_REQUEST_ID.test(value) ? { requestId: value, reason: null } : { requestId: null, reason: 'request_id_header_unusable' };
}

const count = (headers: Headers | null | undefined, name: string): number | null => {
  const raw = typeof headers?.get === 'function' ? headers.get(name) : null;
  if (raw === null) return null;
  const value = raw.trim();
  if (!SAFE_COUNT.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** The eight `anthropic-ratelimit-*` counts, each a bounded non-negative integer or null. */
export function anthropicRateLimitEvidence(headers: Headers | null | undefined): AnthropicRateLimitEvidence {
  const pair = (kind: string): [number | null, number | null] => [
    count(headers, `anthropic-ratelimit-${kind}-limit`), count(headers, `anthropic-ratelimit-${kind}-remaining`),
  ];
  const [requestsLimit, requestsRemaining] = pair('requests');
  const [tokensLimit, tokensRemaining] = pair('tokens');
  const [inputTokensLimit, inputTokensRemaining] = pair('input-tokens');
  const [outputTokensLimit, outputTokensRemaining] = pair('output-tokens');
  return {
    requestsLimit, requestsRemaining, tokensLimit, tokensRemaining,
    inputTokensLimit, inputTokensRemaining, outputTokensLimit, outputTokensRemaining,
  };
}

/**
 * HTTP STATUS TO CLASS, as `gpt-runner.ts` classifies it, plus the balance.
 *
 * A credit refusal is a 400 `invalid_request_error` whose message says the
 * balance is too low (a 402 `billing_error` is the same fact). It is checked
 * first, so it never falls into the generic 400 class.
 */
export function classifyAnthropicStatus(
  status: number, errorType: string | null, creditTooLow: boolean,
): AnthropicArchitectFailureClass {
  if (status === 402 || errorType === 'billing_error') return 'insufficient_credit';
  if (status === 400 && errorType === 'invalid_request_error' && creditTooLow) return 'insufficient_credit';
  if (status === 401) return 'authentication_failed';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limited';
  return 'provider_error';
}

/** The architect's fetch. The origin is `https://api.anthropic.com` only, and a redirect is an error. */
export function anthropicPinnedFetch(fetchImpl: typeof fetch, input: string, init: RequestInit): Promise<Response> {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('anthropic_base_url_unpinned'); }
  if (url.origin !== ANTHROPIC_PINNED_ORIGIN || url.username !== '' || url.password !== '') {
    throw new Error('anthropic_base_url_unpinned');
  }
  return fetchImpl(url.href, { ...init, redirect: 'error' });
}

const isAbort = (error: unknown): boolean => (error as { name?: string } | null)?.name === 'AbortError';

async function readErrorText(response: Response): Promise<string | null> {
  try { return await response.text(); } catch { return null; }
}

/** THE CLASSIFYING READ, unchanged: the first 8,192 characters, parsed, or null. */
function readErrorBody(raw: string | null): { readonly type: unknown; readonly message: string } | null {
  if (raw === null) return null;
  try {
    const text = raw.slice(0, MAX_ERROR_BODY_CHARS);
    const parsed = JSON.parse(text) as { error?: { type?: unknown; message?: unknown } };
    const message = typeof parsed?.error?.message === 'string' ? parsed.error.message : '';
    return { type: parsed?.error?.type, message };
  } catch {
    return null;
  }
}

/** The closed category. Evidence only; it never feeds the class. */
export function providerMessageClass(message: string): AnthropicProviderMessageClass {
  if (CREDIT_TOO_LOW.test(message)) return 'credit_too_low';
  if (SPEND_LIMIT.test(message)) return 'spend_limit';
  if (SCHEMA_TOO_COMPLEX.test(message)) return 'schema_too_complex';
  if (WORKSPACE_HEADER.test(message)) return 'workspace_header';
  return 'other';
}

/**
 * A provider message as a loggable excerpt: whitespace and control characters
 * become one space, anything else outside printable ASCII becomes `?`,
 * key-shaped text and then every 32+ character token become `[redacted]`
 * (all before the cut, so no key survives by straddling it), and the result is
 * at most {@link PROVIDER_MESSAGE_EXCERPT_MAX} characters.
 */
function messageHead(message: string): string {
  return message.length <= SANITIZE_WINDOW ? message : message.slice(0, SANITIZE_WINDOW).replace(/\S*$/u, '');
}

/**
 * THE FORMS OF A SECRET A PROVIDER MIGHT ECHO (PILOT M3): the value, reversed,
 * base64 and hex, each with the run length that equals six characters of the
 * secret (6, or 8 for base64, 12 for hex). URL-encoded and base64url forms need
 * no entry: the run check compares letters and digits only, where a URL-encoded
 * key is the key (plus `2F`-style escapes) and base64url is base64.
 */
function secretForms(secret: string): readonly { readonly form: string; readonly run: number }[] {
  const bytes = new TextEncoder().encode(secret);
  const base64 = globalThis.btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
  const forms = [
    { form: secret, run: 6 },
    { form: secret.split('').reverse().join(''), run: 6 },
    { form: base64, run: 8 },
    { form: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''), run: 12 },
  ];
  return forms.filter((entry) => entry.form.length >= 8);
}
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const joinedAlnum = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/gu, '');

/**
 * FAILS CLOSED (PILOT M3): true when any run of the secret, or of one of its
 * forms, as long as six characters of the secret, is still in the text once
 * every separator is removed, so pieces split by spaces, dashes or invisible
 * marks are re-joined before the check. Case is ignored. Erring towards true
 * only omits an excerpt.
 */
export function messageCarriesSecretRun(text: string, secrets: readonly string[]): boolean {
  const said = joinedAlnum(folded(text));
  if (said.length === 0) return false;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    for (const { form, run } of secretForms(secret)) {
      const plain = joinedAlnum(form);
      for (let i = 0; i + run <= plain.length; i += 1) if (said.includes(plain.slice(i, i + run))) return true;
    }
  }
  return false;
}

export function sanitizeProviderExcerpt(message: string, secrets: readonly string[] = []): string {
  let head = messageHead(folded(message));
  // The exact secrets this request carried, and their encodings, are redacted whatever their shape and case.
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    for (const { form } of secretForms(secret)) head = head.replace(new RegExp(escapeRegExp(form), 'giu'), ` ${REDACTED} `);
  }
  // eslint-disable-next-line no-control-regex
  let text = head.replace(/[\s\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ').replace(/[^\x20-\x7e]/gu, '?');
  for (const shape of KEY_SHAPED) text = text.replace(shape, REDACTED);
  text = text.replace(LONG_TOKEN, REDACTED).replace(/ {2,}/gu, ' ').trim();
  return text.length <= PROVIDER_MESSAGE_EXCERPT_MAX ? text : `${text.slice(0, PROVIDER_MESSAGE_EXCERPT_MAX - 3)}...`;
}

function overlapText(text: string): string {
  return folded(text).toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

/**
 * True when the message shares a run of {@link PROMPT_OVERLAP_WINDOW} normalized
 * characters with any prompt text (a prompt shorter than the window counts when
 * it appears whole and is at least 8 characters). Erring towards true only
 * omits an excerpt.
 */
export function messageQuotesPrompt(message: string, prompts: readonly string[]): boolean {
  const said = overlapText(message);
  if (said.length === 0) return false;
  const windows = new Set<string>();
  for (const prompt of prompts) {
    const text = overlapText(prompt);
    if (text.length < PROMPT_OVERLAP_WINDOW) {
      if (text.length >= 8 && said.includes(text)) return true;
      continue;
    }
    for (let i = 0; i + PROMPT_OVERLAP_WINDOW <= text.length; i += 1) windows.add(text.slice(i, i + PROMPT_OVERLAP_WINDOW));
  }
  for (let i = 0; i + PROMPT_OVERLAP_WINDOW <= said.length; i += 1) {
    if (windows.has(said.slice(i, i + PROMPT_OVERLAP_WINDOW))) return true;
  }
  return false;
}

/** The excerpt, or why there is none. */
export function providerMessageExcerpt(message: string, prompts: readonly string[], secrets: readonly string[] = []): {
  readonly excerpt: string | null; readonly excerptOmitted: 'prompt_overlap' | 'unsafe_residue' | null;
} {
  if (messageQuotesPrompt(messageHead(folded(message)), prompts)) return { excerpt: null, excerptOmitted: 'prompt_overlap' };
  const excerpt = sanitizeProviderExcerpt(message, secrets);
  const scrubbed = excerpt.split(REDACTED).join(' ');
  if (UNSAFE_RESIDUE.some((shape) => shape.test(scrubbed))) return { excerpt: null, excerptOmitted: 'unsafe_residue' };
  // Any six-character run of a secret (or its encodings) left after redaction, re-joined across separators, omits the excerpt.
  if (messageCarriesSecretRun(scrubbed, secrets)) return { excerpt: null, excerptOmitted: 'unsafe_residue' };
  return { excerpt, excerptOmitted: null };
}

async function sha256Hex(text: string): Promise<{ readonly bytes: number; readonly hex: string }> {
  const data = new TextEncoder().encode(text);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
  return { bytes: data.byteLength, hex: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('') };
}

/**
 * THE EVIDENCE READ: the body up to {@link MAX_ERROR_EVIDENCE_CHARS}, so a long
 * message still yields its full length and digest. Null when it is not JSON
 * with an `error` object. Never throws; never returns raw text.
 */
export async function providerMessageEvidence(raw: string | null, prompts: readonly string[] = [], secrets: readonly string[] = []): Promise<AnthropicProviderMessageEvidence | null> {
  if (raw === null || raw.length > MAX_ERROR_EVIDENCE_CHARS) return null;
  let error: { message?: unknown; details?: { error_code?: unknown } } | null;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    error = parsed !== null && typeof parsed === 'object' && parsed.error !== null && typeof parsed.error === 'object'
      ? parsed.error as { message?: unknown; details?: { error_code?: unknown } } : null;
  } catch {
    return null;
  }
  if (error === null) return null;
  const message = typeof error.message === 'string' ? error.message : '';
  const rawCode = error.details !== null && typeof error.details === 'object' ? error.details.error_code : undefined;
  const errorCode = typeof rawCode === 'string' && SAFE_ERROR_CODE.test(rawCode) ? rawCode : null;
  try {
    const { bytes, hex } = await sha256Hex(message);
    return {
      messageClass: providerMessageClass(message),
      errorCode,
      errorCodeUnusable: rawCode !== undefined && rawCode !== null && errorCode === null,
      ...providerMessageExcerpt(message, prompts, secrets),
      messageBytes: bytes,
      messageSha256: hex,
    };
  } catch {
    return null;
  }
}

interface MessagesResponse {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly stop_reason?: unknown;
  readonly content?: unknown;
  readonly usage?: {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
    readonly cache_read_input_tokens?: unknown;
  };
}

const tokens = (raw: unknown): number | null =>
  (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null);

/**
 * Execute exactly one bounded architect request against the Messages API.
 * It never retries and never substitutes another model.
 */
export async function runAnthropicArchitect(
  request: GptRunRequest,
  deps: AnthropicArchitectDeps = {},
): Promise<AnthropicArchitectOutcome> {
  const { config } = request;
  if (config.model === null) {
    return { ok: false, failureClass: 'model_unavailable', message: 'No model is configured.' };
  }
  if (typeof request.apiKey !== 'string' || request.apiKey.trim() === '') {
    return { ok: false, failureClass: 'authentication_failed', message: 'No architect credential is configured.' };
  }
  /* THE SCHEMA IS TRANSFORMED BEFORE ANYTHING ELSE EXISTS: a refusal here is pre-send and spends nothing. */
  let schema: Record<string, unknown>;
  try {
    schema = anthropicStructuredOutputSchema(request.schema?.schema ?? ARCHITECT_PLAN_SCHEMA);
  } catch (error) {
    const keyword = error instanceof AnthropicSchemaUnsupported ? error.keyword : 'schema';
    return {
      ok: false, failureClass: 'architect_schema_unsupported',
      message: `The architect answer schema uses a feature Anthropic structured outputs do not support (${/^[A-Za-z$][A-Za-z0-9_$]{0,40}$/u.test(keyword) ? keyword : 'schema'}); nothing was sent.`,
    };
  }
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  if (request.signal?.aborted) controller.abort();
  request.signal?.addEventListener('abort', onCallerAbort, { once: true });

  const body = {
    model: config.model,
    max_tokens: config.maxOutputTokens,
    system: request.instructions,
    messages: [{ role: 'user', content: request.input }],
    output_config: {
      format: { type: 'json_schema', schema },
      // Only when the mission declared it; absent sends no effort.
      ...(config.reasoningEffort === undefined ? {} : { effort: config.reasoningEffort }),
    },
  };
  const effortSent = config.reasoningEffort ?? null;

  try {
    let response: Response;
    try {
      response = await anthropicPinnedFetch(fetchImpl, ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': request.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbort(error)) return { ok: false, failureClass: 'timeout', message: 'The architect request timed out or was cancelled.' };
      if (error instanceof Error && error.message === 'anthropic_base_url_unpinned') {
        return { ok: false, failureClass: 'provider_error', message: 'The architect endpoint is not the pinned origin.' };
      }
      // A redirect (refused by `redirect: 'error'`), a reset or a DNS failure. No text of it travels.
      return { ok: false, failureClass: 'network_disconnected', message: 'The architect request did not complete (network).' };
    }

    const { requestId, reason } = anthropicRequestId(response.headers);
    const requestFacts = { providerRequestId: requestId, providerRequestUnavailableReason: reason };

    if (!response.ok) {
      const errorText = await readErrorText(response);
      const errorBody = readErrorBody(errorText);
      const errorType = token(errorBody?.type);
      const failureClass = classifyAnthropicStatus(response.status, errorType, CREDIT_TOO_LOW.test(errorBody?.message ?? ''));
      return {
        ok: false, failureClass,
        message: `The architect provider refused the request (HTTP ${response.status}${errorType === null ? '' : `, ${errorType}`}).`,
        ...requestFacts,
        refusal: {
          httpStatus: response.status,
          errorType,
          errorTypeUnparseable: errorBody !== null && errorBody.type !== undefined && errorType === null,
          requestId,
          requestIdUnavailableReason: reason,
          rateLimit: anthropicRateLimitEvidence(response.headers),
          providerMessage: await providerMessageEvidence(errorText, [request.instructions, request.input], [request.apiKey]),
        },
      };
    }

    let parsed: MessagesResponse;
    try {
      parsed = await response.json() as MessagesResponse;
    } catch (error) {
      if (isAbort(error)) return { ok: false, failureClass: 'timeout', message: 'The architect request timed out while its answer was read.', ...requestFacts };
      return { ok: false, failureClass: 'malformed_output', message: 'The provider answer was not readable JSON.', ...requestFacts };
    }

    const actualModel = typeof parsed.model === 'string' && SAFE_MODEL.test(parsed.model) ? parsed.model : undefined;
    const responseId = typeof parsed.id === 'string' && SAFE_ID.test(parsed.id) ? parsed.id : undefined;
    const stopReason = token(parsed.stop_reason);
    const usage: GptUsage = {
      inputTokens: tokens(parsed.usage?.input_tokens),
      cachedInputTokens: tokens(parsed.usage?.cache_read_input_tokens),
      outputTokens: tokens(parsed.usage?.output_tokens),
      // The Messages API reports no separate reasoning count and no total; absent is not zero.
      reasoningTokens: null,
      totalTokens: null,
    };
    const effort: GptEffort = { sent: effortSent, echoed: null };
    const answered = {
      ...(actualModel === undefined ? {} : { actualModel }),
      ...(responseId === undefined ? {} : { responseId }),
      usage, effort, providerStatus: stopReason, ...requestFacts,
    };

    if (parsed.stop_reason === 'refusal') {
      return { ok: false, failureClass: 'refused', message: 'The provider declined this request (refusal).', ...answered };
    }
    if (parsed.stop_reason === 'max_tokens') {
      return {
        ok: false, failureClass: 'incomplete_response',
        message: 'The response was incomplete (max_tokens).', ...answered, incompleteReason: 'max_tokens',
      };
    }
    if (parsed.stop_reason !== 'end_turn') {
      return { ok: false, failureClass: 'provider_error', message: 'The provider reported an unexpected stop reason.', ...answered };
    }

    const blocks = Array.isArray(parsed.content) ? parsed.content as readonly { type?: unknown; text?: unknown }[] : [];
    const outputText = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');
    if (outputText.trim().length === 0) {
      return { ok: false, failureClass: 'malformed_output', message: 'The provider returned no structured output.', ...answered };
    }
    return {
      ok: true,
      // An absent or unusable model is the empty string, which the adapter refuses as
      // `architect_served_model_unattested`. It is never a copy of the requested model.
      actualModel: actualModel ?? '',
      responseId: responseId ?? '',
      status: stopReason ?? 'end_turn', outputText, usage, effort, ...requestFacts,
    };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * THE J1 ARCHITECT RUNNER BOUNDARY. The paid composition asks this function for
 * its runner and calls nothing else, so the runner behind the Agentic Architect
 * is chosen in exactly one place.
 */
export function createJ1ArchitectRunner(deps: AnthropicArchitectDeps = {}): ArchitectRunner {
  return (request) => runAnthropicArchitect(request, deps);
}
