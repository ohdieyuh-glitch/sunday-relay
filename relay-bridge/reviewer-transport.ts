import { resolveRemoteHermes, type RemoteHermesConfig, type RemoteHermesRefusal } from './hermes-remote-review';
import type { HermesConfig, HermesPreflightResult } from './hermes-reviewer';

/**
 * WHICH REVIEWER THIS DEPLOYMENT ACTUALLY HAS, and how to check it is there.
 *
 * The transport was never the hard part. The PREFLIGHT was.
 *
 * `hermesPreflight` probes a LOCAL executable: it runs `hermes --help`, reads
 * `hermes status`, and fails when the binary is absent. On a container it is
 * always absent. So a bridge configured for the remote Reviewer would have
 * been refused at preflight — "hermes executable (not runnable on PATH)" —
 * before the remote path was ever reached, and the transport would have looked
 * broken while being fine.
 *
 * That is not a hypothetical. It is exactly what happened to the hosted Coding
 * Agent: the mission probed for the installed CLI unconditionally, so the
 * hosted occupant died with "Install Claude Code" on a machine that was never
 * going to have it. An independent review found it by running the real
 * registry on a host with no `claude` on PATH. The same shape is refused here
 * in advance.
 *
 * So a transport carries BOTH halves — how to run a review and how to check
 * one could run — and they are chosen together. There is no arrangement in
 * which Relay probes for one reviewer and calls another.
 */

export type ReviewerTransport =
  | { readonly kind: 'local'; readonly reason: string }
  | { readonly kind: 'remote'; readonly config: RemoteHermesConfig }
  | { readonly kind: 'unavailable'; readonly refusal: RemoteHermesRefusal; readonly detail: string };

/**
 * Choose the transport from the environment.
 *
 * `not_remote_mode` is the ONE refusal that means "local", because a bridge
 * that never asked for the remote reviewer is correctly configured for the
 * local one. Every other refusal is a bridge that asked for remote and cannot
 * have it, and that must not silently fall back to a local binary it does not
 * have — a fallback there would turn a configuration mistake into a confusing
 * preflight failure about an executable nobody intended to use.
 */
export function resolveReviewerTransport(env: NodeJS.ProcessEnv): ReviewerTransport {
  const resolution = resolveRemoteHermes(env);
  if (resolution.ok) return { kind: 'remote', config: resolution.config };
  if (resolution.refusal === 'not_remote_mode') {
    return { kind: 'local', reason: 'This bridge is configured to review locally.' };
  }
  return { kind: 'unavailable', refusal: resolution.refusal, detail: resolution.detail };
}

export interface RemoteReadinessDeps {
  readonly fetchImpl?: typeof fetch;
}

/**
 * Is the remote Reviewer there?
 *
 * `/v1/readiness` is offline on the service side — it contacts no provider and
 * creates no run — so this is a side-effect-free probe of exactly the thing
 * that would serve the review, which is the property a readiness probe has to
 * have.
 *
 * It reports what the SERVICE reported. A service that says its credential is
 * absent is not ready, and Relay repeats that rather than deciding for it.
 */
export async function remoteReviewerPreflight(
  config: RemoteHermesConfig,
  deps: RemoteReadinessDeps = {},
): Promise<HermesPreflightResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, config.timeoutMs);

  try {
    const response = await doFetch(`${config.serviceUrl}/v1/readiness`, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ready: false,
        reason: `The Reviewer service answered ${String(response.status)} to a readiness check.`,
        missing: ['reviewer service readiness'],
      } as HermesPreflightResult;
    }
    const body = await response.json() as {
      lifecycle?: string;
      evidence?: {
        installed?: boolean; compatible?: boolean; credentialPresent?: boolean;
        readOnlyEnforceable?: boolean; failureReason?: string | null;
        verifiedModelId?: string | null;
      };
    };

    const evidence = body.evidence ?? {};
    const missing: string[] = [];
    if (body.lifecycle !== undefined && body.lifecycle !== 'running') {
      missing.push(`service lifecycle is ${body.lifecycle}`);
    }
    if (evidence.installed !== true) missing.push('hermes installed on the service');
    if (evidence.compatible !== true) missing.push('a compatible hermes version on the service');
    if (evidence.credentialPresent !== true) missing.push('a provider credential on the service');
    // READ-ONLY IS THE REVIEWER'S WHOLE SAFETY PROPERTY. A service that cannot
    // enforce it is not a Reviewer Relay may use, however healthy it is.
    if (evidence.readOnlyEnforceable !== true) missing.push('enforceable read-only mode on the service');

    if (missing.length > 0) {
      return {
        ready: false,
        reason: evidence.failureReason ?? `The Reviewer service is not ready: ${missing.join(', ')}.`,
        missing,
      } as HermesPreflightResult;
    }

    return {
      ready: true,
      // The service's own verified model, not a guess and not the local
      // configuration — which on a container describes nothing.
      model: evidence.verifiedModelId ?? null,
      provider: null,
      missing: [],
    } as unknown as HermesPreflightResult;
  } catch {
    return {
      ready: false,
      reason: 'The Reviewer service could not be reached for a readiness check.',
      missing: ['reviewer service reachable'],
    } as HermesPreflightResult;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A preflight that matches the transport.
 *
 * The local probe is passed in rather than imported so this module stays free
 * of the spawning path, and so a caller cannot accidentally get the local
 * probe for a remote transport — the mistake this whole module exists to make
 * impossible.
 */
export async function reviewerPreflight(input: {
  readonly transport: ReviewerTransport;
  readonly localConfig: HermesConfig;
  readonly localPreflight: (config: HermesConfig) => HermesPreflightResult;
  readonly deps?: RemoteReadinessDeps;
}): Promise<HermesPreflightResult> {
  switch (input.transport.kind) {
    case 'local':
      return input.localPreflight(input.localConfig);
    case 'remote':
      return await remoteReviewerPreflight(input.transport.config, input.deps ?? {});
    default:
      // Configured for remote and unable to have it. Say THAT, rather than
      // probing for a local binary this deployment never intended to use.
      return {
        ready: false,
        reason: input.transport.detail,
        missing: [input.transport.refusal],
      } as HermesPreflightResult;
  }
}
