import {
  loadHermesProviderConfig, type HermesProviderConfig,
} from '../relay-bridge/reviewer-harness/hermes/hermes-provider';
import { SERVICE_TOKEN_ENV } from './service';

/**
 * SERVICE CONFIGURATION — read once, validated before anything listens.
 *
 * A service that boots with a missing token, no provider, or no model is worse
 * than one that refuses to boot: it answers health checks, looks alive, and
 * then fails every real request with something that reads like a runtime fault
 * rather than the configuration error it is. So this fails closed, and every
 * problem it reports names a VARIABLE, never a value.
 *
 * The provider is never inferred from which credential happens to be set.
 * Picking xAI because `XAI_API_KEY` exists is exactly the assumption this
 * milestone removed, and re-introducing it here — where it would be invisible
 * — would be worse than leaving it in the adapter.
 */

export const HERMES_EXECUTABLE_ENV = 'RELAY_HERMES_EXECUTABLE';
export const HOST_ENV = 'HOST';
export const PORT_ENV = 'PORT';

/** Local convenience only. A platform always injects PORT. */
export const DEFAULT_PORT = 8791;
export const DEFAULT_HOST = '0.0.0.0';

export interface HermesServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly serviceToken: string;
  readonly executable: string;
  readonly provider: HermesProviderConfig;
  readonly apiKey: string;
  readonly production: boolean;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: HermesServiceConfig }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Validate the environment. Returns EVERY problem rather than the first, so an
 * operator fixes one deployment instead of discovering faults one restart at
 * a time.
 */
export function loadServiceConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const problems: string[] = [];

  const serviceToken = (env[SERVICE_TOKEN_ENV] ?? '').trim();
  if (serviceToken === '') {
    problems.push(`${SERVICE_TOKEN_ENV} is required; the Hermes Reviewer service will not start unauthenticated.`);
  }

  const executable = (env[HERMES_EXECUTABLE_ENV] ?? '').trim() || 'hermes';

  const provider = loadHermesProviderConfig(env);
  if (!provider.ok) {
    problems.push(provider.safeMessage);
  }

  let apiKey = '';
  if (provider.ok) {
    apiKey = (env[provider.config.credentialEnvName] ?? '').trim();
    if (apiKey === '') {
      // Named, never valued. This line can reach a deployment log.
      problems.push(
        `${provider.config.credentialEnvName} is required because ${provider.config.provider} is the configured provider.`,
      );
    }
  }

  const rawPort = (env[PORT_ENV] ?? '').trim();
  let port = DEFAULT_PORT;
  if (rawPort !== '') {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      problems.push(`${PORT_ENV} must be an integer between 1 and 65535.`);
    } else {
      port = parsed;
    }
  }

  const host = (env[HOST_ENV] ?? '').trim() || DEFAULT_HOST;
  if (/\s/.test(host)) problems.push(`${HOST_ENV} is not a usable bind address.`);

  if (problems.length > 0 || !provider.ok) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    config: {
      host,
      port,
      serviceToken,
      executable,
      provider: provider.config,
      apiKey,
      production: env.NODE_ENV === 'production',
    },
  };
}

/**
 * The only description of the configuration that may be logged.
 *
 * Note what is absent: the token, its length, the credential, the private URL,
 * and — in production — the executable path, which is host layout. A startup
 * line goes straight into a platform log that many people can read.
 */
export function describeStartup(config: HermesServiceConfig): string {
  return [
    `Hermes Reviewer service listening on ${config.host}:${config.port}`,
    `provider: ${config.provider.provider}`,
    `requested model: ${config.provider.requestedModel}`,
    `credential: configured`,
    `auth: required`,
    config.production ? 'executable: configured' : `executable: ${config.executable}`,
  ].join(' · ');
}
