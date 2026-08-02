import { loadHermesProviderConfig } from './hermes-provider';
import {
  selectHermesMode,
  type HermesFailureKind, type HermesReviewerTransport,
} from './hermes-transport';
import { createRemoteHermesTransport } from './remote-transport';

/**
 * BUILDING THE TRANSPORT THE BRIDGE WILL ACTUALLY USE.
 *
 * The local implementation is imported LAZILY, and that is the point. A static
 * import would pull `node:child_process`, discovery and the profile builder
 * into the bridge bundle for every deployment, including production remote
 * ones that must never be able to spawn. Loading it only when local mode is
 * genuinely selected keeps "cannot spawn" a property of the remote build
 * rather than a promise about it.
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

  // Lazy: keeps the process-spawning module out of a remote-mode bundle.
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
