import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

/**
 * HOSTED CODING AGENT READINESS — free, offline, and never a provider call.
 *
 * This answers "could this box run a hosted Coding Agent?" using only facts it
 * can check locally: is the Agent SDK installed, did the platform-specific
 * runtime binary come with it, and is a server-side credential present. It
 * deliberately does NOT verify the credential works — that would cost money,
 * and a readiness probe that spends money cannot be called from a status page.
 *
 * Consequently `credentialPresent: true` means exactly "a variable is set",
 * never "the key is valid". The distinction is preserved all the way to the
 * surface: readiness can say a live run is POSSIBLE; only a run can say it
 * worked.
 */

export const HOSTED_API_KEY_ENV = 'ANTHROPIC_API_KEY';
export const HOSTED_MODEL_ENV = 'RELAY_HOSTED_CODING_MODEL';
export const HOSTED_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

/**
 * The three execution surfaces Relay can report, and the only three. A surface
 * is a statement about WHERE the work ran, kept separate from whether it
 * succeeded.
 */
export const CODING_AGENT_SURFACES = [
  'local_claude_code',
  'hosted_anthropic',
  'unavailable',
] as const;
export type CodingAgentSurface = (typeof CODING_AGENT_SURFACES)[number];

/** Adapter ids, mapped 1:1 onto the surface each one actually executes on. */
export const HOSTED_ADAPTER_ID = 'claude-agent-sdk-hosted';
export const LOCAL_ADAPTER_ID = 'claude-code-local';

export function surfaceForAdapter(adapterId: string | null): CodingAgentSurface {
  if (adapterId === HOSTED_ADAPTER_ID) return 'hosted_anthropic';
  if (adapterId === LOCAL_ADAPTER_ID) return 'local_claude_code';
  // An adapter Relay does not recognise has not proven where it ran.
  return 'unavailable';
}

export interface HostedReadiness {
  /** True when the Agent SDK package resolves in this deployment. */
  readonly sdkInstalled: boolean;
  readonly sdkVersion: string | null;
  /** True when the platform-native runtime for THIS host is present. */
  readonly runtimeBinaryPresent: boolean;
  readonly platform: string;
  /** A credential VARIABLE is set. Never a claim that it is valid. */
  readonly credentialPresent: boolean;
  /** The model the deployment requests, when configured. Relay picks none. */
  readonly requestedModel: string | null;
  /** Whether a hosted run could be attempted at all. */
  readonly surface: CodingAgentSurface;
  /** Exactly why a hosted run cannot be attempted, when it cannot. */
  readonly blockedReason: string | null;
  readonly checkedAt: string;
}

/** The optional-dependency package that carries this host's runtime binary. */
export function runtimePackageFor(platform: string, arch: string): string | null {
  const os = platform === 'linux' ? 'linux'
    : platform === 'darwin' ? 'darwin'
      : platform === 'win32' ? 'win32' : null;
  const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  if (os === null || cpu === null) return null;
  return `${HOSTED_SDK_PACKAGE}-${os}-${cpu}`;
}

export interface ResolveProbe {
  /** Resolves a package id to a path, or throws when it is absent. */
  resolve(id: string): string;
  /** Reads a resolved package's version, or null when unreadable. */
  version(id: string): string | null;
}

/**
 * The real resolver. Injected in tests so readiness can be proven offline.
 *
 * It resolves the package ENTRY POINT, not `<id>/package.json`. That is not a
 * stylistic choice: the Agent SDK declares an `exports` map with no
 * `./package.json` entry, and modern Node enforces those maps — so probing the
 * manifest directly throws ERR_PACKAGE_PATH_NOT_EXPORTED on a perfectly
 * installed package. The first version of this probe did exactly that and
 * reported an installed runtime as missing.
 *
 * `require.resolve` returns the path without executing the module, so this
 * stays free even though the SDK itself is ESM.
 */
export function nodeResolveProbe(): ResolveProbe {
  const require_ = createRequire(__filename);
  const manifestFor = (id: string): { version?: unknown } | null => {
    try {
      // Walk up from the resolved entry to the package root's manifest, which
      // is readable from disk even when `exports` hides it from resolution.
      const entry = require_.resolve(id);
      const marker = `node_modules${sep}${id.split('/').join(sep)}${sep}`;
      const index = entry.lastIndexOf(marker);
      if (index === -1) return null;
      const root = entry.slice(0, index + marker.length);
      return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
    } catch {
      return null;
    }
  };
  return {
    // Two package shapes, two resolution strategies, and BOTH are needed.
    // The SDK is a normal package with an `exports` map that hides its
    // manifest, so it resolves by entry point. Its platform runtime packages
    // are binary-only with no usable entry point, so they resolve by manifest.
    // A probe that knew only one strategy reported half of a correct
    // installation as missing — which is how both of these were found.
    resolve: (id) => {
      try {
        return require_.resolve(id);
      } catch {
        return require_.resolve(`${id}/package.json`);
      }
    },
    version: (id) => {
      const pkg = manifestFor(id);
      return pkg !== null && typeof pkg.version === 'string' ? pkg.version : null;
    },
  };
}

/**
 * Probe the deployment. Makes no network request of any kind.
 *
 * The musl fallback matters on hosted Linux: an Alpine-based image carries the
 * `-musl` runtime rather than the glibc one, and a probe that only knew the
 * glibc name would report a perfectly capable host as unavailable.
 */
export function probeHostedReadiness(input: {
  env: NodeJS.ProcessEnv;
  now: string;
  platform?: string;
  arch?: string;
  probe?: ResolveProbe;
}): HostedReadiness {
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const probe = input.probe ?? nodeResolveProbe();

  let sdkInstalled = false;
  let sdkVersion: string | null = null;
  try {
    probe.resolve(HOSTED_SDK_PACKAGE);
    sdkInstalled = true;
    sdkVersion = probe.version(HOSTED_SDK_PACKAGE);
  } catch {
    sdkInstalled = false;
  }

  const base = runtimePackageFor(platform, arch);
  let runtimeBinaryPresent = false;
  if (base !== null) {
    for (const candidate of [base, `${base}-musl`]) {
      try {
        probe.resolve(candidate);
        runtimeBinaryPresent = true;
        break;
      } catch {
        /* try the next variant */
      }
    }
  }

  const rawKey = input.env[HOSTED_API_KEY_ENV];
  const credentialPresent = typeof rawKey === 'string' && rawKey.trim() !== '';
  const rawModel = input.env[HOSTED_MODEL_ENV];
  const requestedModel = typeof rawModel === 'string' && rawModel.trim() !== ''
    ? rawModel.trim()
    : null;

  const blockedReason = !sdkInstalled
    ? `The hosted Coding Agent runtime (${HOSTED_SDK_PACKAGE}) is not installed in this deployment.`
    : !runtimeBinaryPresent
      ? `The hosted Coding Agent runtime has no executable for ${platform}/${arch} in this deployment.`
      : !credentialPresent
        ? `No ${HOSTED_API_KEY_ENV} is configured on the Relay Bridge. The browser never holds this credential.`
        : requestedModel === null
          ? `No ${HOSTED_MODEL_ENV} is configured, and Relay will not choose a model on your behalf.`
          : null;

  return {
    sdkInstalled,
    sdkVersion,
    runtimeBinaryPresent,
    platform: `${platform}/${arch}`,
    credentialPresent,
    requestedModel,
    surface: blockedReason === null ? 'hosted_anthropic' : 'unavailable',
    blockedReason,
    checkedAt: input.now,
  };
}

/**
 * The browser-safe view. Everything here is a fact ABOUT configuration, never
 * configuration itself: no key, no key length, no key prefix, no hash, and no
 * filesystem path that would describe the host's layout.
 */
export interface SanitizedHostedStatus {
  readonly surface: CodingAgentSurface;
  readonly runtimeInstalled: boolean;
  readonly runtimeVersion: string | null;
  readonly credentialConfigured: boolean;
  readonly requestedModel: string | null;
  readonly blockedReason: string | null;
  readonly checkedAt: string;
}

export function sanitizeHostedStatus(readiness: HostedReadiness): SanitizedHostedStatus {
  return {
    surface: readiness.surface,
    runtimeInstalled: readiness.sdkInstalled && readiness.runtimeBinaryPresent,
    runtimeVersion: readiness.sdkVersion,
    credentialConfigured: readiness.credentialPresent,
    requestedModel: readiness.requestedModel,
    blockedReason: readiness.blockedReason,
    checkedAt: readiness.checkedAt,
  };
}
