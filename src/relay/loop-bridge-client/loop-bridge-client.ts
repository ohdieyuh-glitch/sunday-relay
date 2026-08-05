import {
  BRIDGE_API_BASE, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT_MS,
  redactBridgeSecrets, resolveBridgeTarget, resolveBridgeToken,
} from '../reviewer-bridge-client';
import type {
  LoopClientResult, LoopExecutionClient,
} from '../cli/loop-execution';
import type {
  LoopHistoryEntry, LoopInspectionProjection, LoopStatusProjection,
} from '../mission';

/**
 * THE LOOP BRIDGE CLIENT — the half of Stage 2 that was missing.
 *
 * `src/relay/cli/loop-execution.ts` declared `LoopExecutionClient` and every
 * command that drives it, with its own tests, and NOTHING implemented it. The
 * CLI could parse a Loop, resolve its target, gate it and print a preview; it
 * could not read a run, and nothing in argv reached the runtime that had
 * landed three commits earlier. A port with no adapter is a feature that exists
 * in the repository and not in the product.
 *
 * IT DECIDES NOTHING, exactly like the Reviewer client beside it. It moves
 * bytes, classifies transport failures, and hands back the server's own
 * projection. Whether a Loop may run, whether it is finished, what it spent and
 * whether a control is permitted are all server decisions — this file contains
 * no branch that could second-guess one, and in particular it never synthesises
 * a status from a failed request.
 *
 * THE TOKEN travels in an `Authorization` header and nowhere else: never in the
 * URL (proxies log those), never in argv (the process table is world readable),
 * never in a message and never in an error. Everything a server sends back goes
 * through `redactBridgeSecrets` before it can be printed.
 *
 * WHY IT REUSES `reviewer-bridge-client` RATHER THAN COPYING IT. Target
 * validation is a security control: it refuses a cleartext remote URL, refuses
 * credentials in the URL, and refuses to silently degrade a configured remote
 * bridge to localhost. A second copy of that would drift, and the drifted copy
 * would be the one carrying a token somewhere it should not.
 */

/** Loop routes live under the one bridge route family. */
const LOOP_BASE = `${BRIDGE_API_BASE}/loop`;

export interface LoopBridgeClientOptions {
  readonly bridgeUrl: string | undefined | null;
  readonly token: string | undefined | null;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

const failure = (status: number, kind: string, message: string): LoopClientResult<never> =>
  ({ ok: false, status, kind, message });

/**
 * An HTTP status and the server's own kind, mapped to one honest sentence.
 *
 * The SERVER'S classification wins wherever it gives one — it knows why it
 * refused. The fallbacks below are only for a status with no usable body, and
 * each one is careful to describe the transport rather than the run: "Relay
 * could not read this run" is a different claim from "this run failed", and a
 * client that blurs them reports outages as Loop failures.
 */
function classify(status: number, kind: string | null, message: string | null): LoopClientResult<never> {
  if (kind !== null && kind !== '') {
    return failure(status, kind, message ?? `The Relay Bridge refused this Loop request (${kind}).`);
  }
  if (status === 401) {
    // Deliberately incurious: never reveal whether the token was absent,
    // malformed, expired or simply wrong.
    return failure(status, 'authentication_failed', 'The Relay Bridge rejected the credential.');
  }
  if (status === 403) {
    return failure(status, 'authorization_required', 'This Loop operation is not authorized.');
  }
  if (status === 404) {
    return failure(status, 'not_found', 'The Relay Bridge has no such Loop route or run.');
  }
  return failure(
    status, 'server_failure',
    `The Relay Bridge answered HTTP ${status}. Nothing is claimed about the Loop itself.`,
  );
}

export function createLoopBridgeClient(options: LoopBridgeClientOptions): LoopExecutionClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  const call = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<LoopClientResult<T>> => {
    const target = resolveBridgeTarget(options.bridgeUrl);
    if (!target.ok) return failure(0, target.error.kind, target.error.message);
    const token = resolveBridgeToken(options.token);
    if (!token.ok) return failure(0, token.error.kind, token.error.message);

    const controller = new AbortController();
    // A timeout and a refused connection are DIFFERENT facts with different
    // fixes, and both arrive here as one exception — so which one we caused is
    // recorded rather than guessed at afterwards.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await doFetch(`${target.value.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token.value}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        // A followed redirect is how a bearer token reaches an origin nobody
        // configured. The bridge never redirects; if one appears, it is refused.
        redirect: 'manual',
      });
    } catch {
      return timedOut
        ? failure(0, 'timeout', `The Relay Bridge did not answer within ${timeoutMs} ms.`)
        : failure(0, 'unreachable', 'The Relay Bridge could not be reached.');
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      return failure(
        response.status, 'unreachable',
        'The Relay Bridge replied with a redirect. Relay does not follow redirects for an '
        + 'authenticated call: the credential is issued for one configured origin.',
      );
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch {
      return failure(response.status, 'invalid_response', 'The Relay Bridge response could not be read.');
    }
    if (Buffer.byteLength(raw, 'utf8') > maxResponseBytes) {
      return failure(response.status, 'invalid_response', 'The Relay Bridge response exceeded the size ceiling.');
    }

    let parsed: unknown;
    try {
      parsed = raw === '' ? null : JSON.parse(raw);
    } catch {
      return failure(response.status, 'invalid_response', 'The Relay Bridge sent a body that is not JSON.');
    }
    const envelope = (parsed !== null && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : {};

    if (!response.ok) {
      /*
       * BOTH FIELDS ARE UNTRUSTED, AND BOTH ARE PRINTED.
       *
       * `error` was redacted and `kind` was not — and `loop-execution.ts`
       * prints the kind to stdout. A server that answered
       * `{"kind":"refused: <token>"}` therefore got the credential onto the
       * terminal, past a docstring promising the token is "never in a message
       * and never in an error". Redacting one field and printing the other is
       * not redaction.
       *
       * The kind is also BOUNDED and shape-checked: it is a vocabulary word
       * the CLI branches on, not free text, so a kilobyte of prose in that slot
       * is a malformed response rather than something to relay onward.
       */
      const rawKind = typeof envelope.kind === 'string' ? envelope.kind : null;
      const kind = rawKind !== null && /^[a-z][a-z0-9_]{0,63}$/u.test(rawKind)
        ? rawKind
        : null;
      const message = typeof envelope.error === 'string'
        // The token is passed so the literal value is removed, not merely
        // anything token-SHAPED. A server that echoes the credential back must
        // not be able to get it printed.
        ? redactBridgeSecrets(envelope.error.slice(0, 2000), token.value)
        : null;
      return classify(response.status, kind, message);
    }
    /*
     * `'data' in envelope` was the whole check, so `{"data":null}` and
     * `{"data":5}` both came back `ok: true` — and the renderer then threw
     * `Cannot read properties of null` inside a promise the CLI does not catch,
     * which is an unhandled rejection rather than a message. The Reviewer
     * client this one deliberately mirrors rejects exactly this; drifting from
     * it silently is how two clients stop behaving alike.
     */
    const data = envelope.data;
    if (data === null || data === undefined || typeof data !== 'object') {
      return failure(
        response.status, 'invalid_response',
        'The Relay Bridge sent no usable data envelope.',
      );
    }
    return { ok: true, data: data as T };
  };

  const encode = (id: string): string => encodeURIComponent(id);

  return {
    capability: () => call('GET', `${LOOP_BASE}/capability`),
    confirm: (input) => call('POST', `${LOOP_BASE}/confirm`, input),
    status: (runId) => call<LoopStatusProjection>('GET', `${LOOP_BASE}/status/${encode(runId)}`),
    inspect: (runId) => call<LoopInspectionProjection>('GET', `${LOOP_BASE}/inspect/${encode(runId)}`),
    history: (loopId) => call<{ readonly runs: readonly LoopHistoryEntry[] }>(
      'GET', `${LOOP_BASE}/history/${encode(loopId)}`,
    ),
    control: ({ runId, action, requestId, reason }) => call(
      'POST', `${LOOP_BASE}/${action}/${encode(runId)}`, { requestId, reason },
    ),
  };
}
