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
 * `anthropic-ratelimit-*` counts. The provider's message is read for ONE
 * purpose, to recognise a credit-balance refusal, and is then dropped.
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

async function readErrorBody(response: Response): Promise<{ readonly type: unknown; readonly message: string } | null> {
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
    const parsed = JSON.parse(text) as { error?: { type?: unknown; message?: unknown } };
    const message = typeof parsed?.error?.message === 'string' ? parsed.error.message : '';
    return { type: parsed?.error?.type, message };
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
      const errorBody = await readErrorBody(response);
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
