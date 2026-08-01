/**
 * HERMES DISCOVERY — what is actually installed, proven locally.
 *
 * Runs only non-destructive, local probes: `--version`, `--help` and
 * `acp --check`. It contacts NO inference provider, so discovery is free and
 * may run on a status request. It also writes nothing: the probes run with an
 * isolated HERMES_HOME so they cannot touch the operator's own configuration.
 *
 * "A binary exists" is deliberately NOT the same as "connected". Discovery
 * answers four separate questions — is it there, is the version compatible,
 * does it expose the machine interface this adapter depends on, and can
 * read-only be enforced for it — and each has its own field.
 */

import { spawnSync } from 'node:child_process';
import { safeText } from '../../redact';

/** The one-shot flags this adapter depends on, proven from local `--help`. */
export const REQUIRED_ONESHOT_FLAGS = ['-z', '--usage-file', '-t', '--ignore-rules'] as const;

/** Minimum Hermes that exposes one-shot + usage reporting + toolset control. */
export const MINIMUM_HERMES_VERSION = '0.18.0';

export type HermesMachineInterface = 'oneshot_json' | 'acp_stdio' | null;

export interface HermesDiscovery {
  readonly installed: boolean;
  readonly binaryPath: string | null;
  readonly version: string | null;
  readonly compatible: boolean;
  readonly machineInterface: HermesMachineInterface;
  readonly machineInterfaceVerified: boolean;
  /** Every required flag this build exposes, for a truthful failure message. */
  readonly supportedFlags: readonly string[];
  readonly missingFlags: readonly string[];
  /** ACP is probed for reporting only; it is not the selected transport. */
  readonly acpAvailable: boolean;
  readonly readOnlyEnforceable: boolean;
  readonly failureReason: string | null;
}

export const NOT_INSTALLED: HermesDiscovery = Object.freeze({
  installed: false, binaryPath: null, version: null, compatible: false,
  machineInterface: null, machineInterfaceVerified: false,
  supportedFlags: [], missingFlags: [...REQUIRED_ONESHOT_FLAGS], acpAvailable: false,
  readOnlyEnforceable: false,
  failureReason: 'No Hermes runtime was found. Install Hermes Agent and make it reachable on PATH.',
});

export interface ProbeResult { readonly ok: boolean; readonly text: string; }
export type Probe = (executable: string, args: string[]) => ProbeResult;

/**
 * A probe never inherits the operator's environment beyond PATH, and never
 * their Hermes home — so it cannot read personal memory or mutate config.
 */
export function createProbe(isolatedHome: string): Probe {
  return (executable, args) => {
    try {
      const r = spawnSync(executable, args, {
        encoding: 'utf8',
        timeout: 20_000,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: isolatedHome, HERMES_HOME: isolatedHome },
      });
      if (r.error) return { ok: false, text: '' };
      return { ok: r.status === 0, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
    } catch {
      return { ok: false, text: '' };
    }
  };
}

/** `Hermes Agent v0.18.2 (2026.7.7.2) · upstream … · local …` → `0.18.2`. */
export function parseHermesVersion(text: string): string | null {
  const m = /Hermes\s+Agent\s+v(\d+\.\d+\.\d+)/i.exec(text) ?? /^v?(\d+\.\d+\.\d+)$/m.exec(text.trim());
  return m ? m[1] : null;
}

/** Numeric compare; a version Relay cannot parse is never "compatible". */
export function versionAtLeast(found: string | null, minimum: string): boolean {
  if (found === null) return false;
  const a = found.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  if (a.some((n) => !Number.isFinite(n))) return false;
  for (let i = 0; i < 3; i += 1) {
    const l = a[i] ?? 0;
    const r = b[i] ?? 0;
    if (l !== r) return l > r;
  }
  return true;
}

export function discoverHermes(input: {
  executable: string;
  probe: Probe;
}): HermesDiscovery {
  const { executable, probe } = input;

  const version = probe(executable, ['--version']);
  if (!version.ok && !version.text.trim()) return NOT_INSTALLED;

  const parsedVersion = parseHermesVersion(version.text);
  const compatible = versionAtLeast(parsedVersion, MINIMUM_HERMES_VERSION);

  const help = probe(executable, ['--help']);
  const supportedFlags = REQUIRED_ONESHOT_FLAGS.filter((flag) => help.text.includes(flag));
  const missingFlags = REQUIRED_ONESHOT_FLAGS.filter((flag) => !help.text.includes(flag));

  const acp = probe(executable, ['acp', '--check']);
  const acpAvailable = acp.ok && /ACP check OK/i.test(acp.text);

  // The one-shot transport is selected only when EVERY flag it depends on is
  // present. A partial match is reported as unverified rather than attempted.
  const machineInterfaceVerified = missingFlags.length === 0 && compatible;
  const machineInterface: HermesMachineInterface = machineInterfaceVerified ? 'oneshot_json' : null;

  // Read-only is enforced by granting NO toolset through an isolated profile,
  // which requires the toolset flag and rule suppression to both exist.
  const readOnlyEnforceable = help.text.includes('-t') && help.text.includes('--ignore-rules');

  const failureReason = (() => {
    if (parsedVersion === null) return 'Relay could not read a Hermes version from this runtime.';
    if (!compatible) {
      return `Hermes ${parsedVersion} is older than the minimum ${MINIMUM_HERMES_VERSION} this adapter requires.`;
    }
    if (missingFlags.length > 0) {
      return `This Hermes build does not expose ${missingFlags.join(', ')}, which the one-shot transport requires.`;
    }
    if (!readOnlyEnforceable) return 'Relay cannot prove read-only execution for this Hermes build.';
    return null;
  })();

  return {
    installed: true,
    binaryPath: safeText(executable),
    version: parsedVersion === null ? null : safeText(parsedVersion),
    compatible,
    machineInterface,
    machineInterfaceVerified,
    supportedFlags,
    missingFlags,
    acpAvailable,
    readOnlyEnforceable,
    failureReason,
  };
}
