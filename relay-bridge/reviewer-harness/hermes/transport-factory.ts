import { loadHermesProviderConfig } from './hermes-provider';
import {
  selectHermesMode,
  type HermesFailureKind, type HermesReviewerTransport,
} from './hermes-transport';
import { createRemoteHermesTransport } from './remote-transport';

/**
 * BUILDING THE TRANSPORT THE BRIDGE WILL ACTUALLY USE.
 *
 * The local implementation is imported LAZILY. Be precise about what that
 * buys: esbuild still BUNDLES the module, so `createLocalHermesTransport` is
 * present in the bridge artifact either way — the dynamic import defers
 * EVALUATION, not inclusion. What it guarantees is that in remote mode the
 * module is never evaluated, so discovery never runs, no isolated profile is
 * created and `child_process` is never reached through this path.
 *
 * The structural guarantee that remote cannot spawn lives in
 * `remote-transport.ts`, which references no process API at all and has a test
 * asserting it. This lazy import is a defence-in-depth measure on top of that,
 * not the boundary itself.
 *
 * Selection failures return a transport-shaped refusal instead of throwing, so
 * a misconfigured bridge answers every Reviewer route with a categorised
 * reason rather than a stack trace — and, critically, never silently degrades
 * to probing its own container.
 *
 * THE LOCAL TRANSPORT IS BUILT ONCE PER PROCESS, and that is not an
 * optimisation.
 *
 * `local-transport.ts` enforces its ceilings in closure-local counters, so N
 * instances enforce N × the ceiling. This factory used to build a fresh one
 * per request, which its own comment called "harmless today because no bridge
 * route calls `startReview`, and a live hazard the moment one does" — leaving
 * the correctness of a concurrency bound resting on nobody adding a route.
 *
 * That is a landmine, not a design. The instance is cached on the resolved
 * CONFIGURATION, so a process holds one transport per distinct configuration
 * and the ceilings mean what they say no matter who wires a route later.
 *
 * Remote transports are NOT cached: they hold no counters, and caching them
 * would make a rotated service token survive in memory after it changed.
 */

export type TransportResult =
  | { readonly ok: true; readonly transport: HermesReviewerTransport }
  | { readonly ok: false; readonly kind: HermesFailureKind; readonly safeMessage: string };

export async function buildHermesTransport(input: {
  env: NodeJS.ProcessEnv;
  production: boolean;
}): Promise<TransportResult> {
  const selection = selectHermesMode(input);
  if (!selection.ok) {
    return { ok: false, kind: selection.kind, safeMessage: selection.safeMessage };
  }

  if (selection.mode === 'remote') {
    return {
      ok: true,
      transport: createRemoteHermesTransport({
        serviceUrl: selection.serviceUrl,
        serviceToken: selection.serviceToken,
      }),
    };
  }

  // Local mode needs provider identity to name what it is reviewing with.
  const provider = loadHermesProviderConfig(input.env);
  if (!provider.ok) {
    return { ok: false, kind: provider.kind, safeMessage: provider.safeMessage };
  }
  const credential = input.env[provider.config.credentialEnvName] ?? null;

  const executable = selection.executableOverride ?? 'hermes';
  const apiKey = credential !== null && credential.trim() !== '' ? credential : null;

  /**
   * Keyed on everything that changes what the transport IS — never on the
   * credential VALUE, which must not become a map key anywhere. A rotated
   * credential reuses the instance, which is correct: the counters belong to
   * the process, and rotating a key does not reset a concurrency ceiling.
   */
  const key = [
    executable,
    provider.config.provider,
    // The MODEL is part of what the transport is: two models are two different
    // reviewers, and sharing one instance between them would attribute a run
    // to the wrong one.
    provider.config.requestedModel,
    String(apiKey !== null),
  ].join('\u0000');
  const cached = localTransports.get(key);
  if (cached !== undefined) return { ok: true, transport: cached };

  // Lazy: never evaluated in remote mode. Bundled, but not reached.
  const { createLocalHermesTransport } = await import('./local-transport');
  const transport = createLocalHermesTransport({
    executable,
    provider: provider.config,
    env: input.env,
    apiKey,
  });
  localTransports.set(key, transport);
  return { ok: true, transport };
}

/**
 * One local transport per distinct configuration, for the process lifetime.
 *
 * Module-level on purpose: `relay-hermes-service/main.ts` achieves the same
 * bound by holding a single instance itself, and the bridge has no equivalent
 * place to hold one — every route builds through this factory.
 */
const localTransports = new Map<string, HermesReviewerTransport>();

/** Test seam. Nothing in production drops a transport mid-process. */
export function resetHermesTransportCacheForTests(): void {
  localTransports.clear();
}
