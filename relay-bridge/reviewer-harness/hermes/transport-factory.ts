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

  // Lazy: never evaluated in remote mode. Bundled, but not reached.
  const { createLocalHermesTransport } = await import('./local-transport');
  return {
    ok: true,
    transport: createLocalHermesTransport({
      executable: selection.executableOverride ?? 'hermes',
      provider: provider.config,
      env: input.env,
      apiKey: credential !== null && credential.trim() !== '' ? credential : null,
    }),
  };
}
