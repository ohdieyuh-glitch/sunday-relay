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
import { DISABLED_TOOLSETS, WRITE_CAPABLE_TOOLSETS, isolatedConfigYaml } from './isolated-profile';

/**
 * Read-only rests on the generated profile, so readiness checks the profile
 * Relay would actually write — not a flag that happens to exist.
 */
export function generatedProfileDisablesEveryToolset(): boolean {
  const yaml = isolatedConfigYaml();
  if (!yaml.includes('disabled_toolsets:')) return false;
  if (!/max_turns:\s*1\b/.test(yaml)) return false;
  if (!yaml.includes('mcp_servers: {}')) return false;
  // Every toolset Relay knows about, and every write-capable one explicitly.
  const named = [...new Set([...DISABLED_TOOLSETS, ...WRITE_CAPABLE_TOOLSETS])];
  return named.every((t) => new RegExp(`^\\s*-\\s*${t}\\s*$`, 'm').test(yaml));
}

/**
 * THE FLAGS THE RUNNER ACTUALLY PASSES, and therefore the only ones readiness
 * has any business requiring.
 *
 * This list used to require `-t` and not require `-m` or `--provider`. That
 * was backwards on both counts: `-t/--toolsets` is an ENABLE list the runner
 * deliberately never passes (isolation comes from the profile's
 * `agent.disabled_toolsets`), while `-m` and `--provider` are passed on every
 * single run — so a Hermes with no model or provider selection passed
 * readiness and then failed at execution.
 *
 * Verified against the installed Hermes `--help`:
 *   -z/--oneshot      single prompt, final response only
 *   --usage-file      one-shot usage report
 *   -m/--model        model override for this invocation
 *   --provider        provider override for this invocation
 *   --ignore-rules    skip AGENTS.md, SOUL.md, .cursorrules, memory, skills
 */
export const REQUIRED_ONESHOT_FLAGS = [
  '-z', '--usage-file', '-m', '--provider', '--ignore-rules',
] as const;

/**
 * The toolset flag. Relay does NOT pass it — it enables toolsets, and the
 * Reviewer wants none — but its presence is what tells us this build has the
 * toolset system the profile's `disabled_toolsets` key drives.
 */
export const TOOLSET_FLAG = '-t';

/**
 * Does `--help` really advertise this flag?
 *
 * Naive substring matching is wrong for short flags and silently so: `-m`
 * appears inside `--safe-mode`, and `-t` inside `--worktree`, so a build
 * exposing neither would still be reported as supporting both. A flag must
 * appear as its own token — delimited by whitespace, a comma, a bracket or an
 * `=` — exactly as an argument parser prints it.
 */
export function helpAdvertisesFlag(helpText: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s,\\[(])${escaped}([\\s,\\])=]|$)`, 'm').test(helpText);
}

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
  const supportedFlags = REQUIRED_ONESHOT_FLAGS.filter((flag) => helpAdvertisesFlag(help.text, flag));
  const missingFlags = REQUIRED_ONESHOT_FLAGS.filter((flag) => !helpAdvertisesFlag(help.text, flag));

  const acp = probe(executable, ['acp', '--check']);
  const acpAvailable = acp.ok && /ACP check OK/i.test(acp.text);

  // The one-shot transport is selected only when EVERY flag it depends on is
  // present. A partial match is reported as unverified rather than attempted.
  const machineInterfaceVerified = missingFlags.length === 0 && compatible;
  const machineInterface: HermesMachineInterface = machineInterfaceVerified ? 'oneshot_json' : null;

  // READ-ONLY EVIDENCE MUST DESCRIBE THE MECHANISM THAT ENFORCES IT.
  //
  // This used to be `help.includes('-t') && help.includes('--ignore-rules')`
  // — a flag the runner never passes, standing in as proof for a mechanism it
  // has nothing to do with. Read-only is actually enforced by the Relay-owned
  // profile: `agent.disabled_toolsets` names every toolset this build exposes,
  // `agent.max_turns: 1` pins one turn, and `mcp_servers`/`plugins`/`hooks`
  // are empty. `--ignore-rules` is the second lock, and IS passed.
  //
  // So the evidence now requires: the build has the toolset system the
  // profile drives, rule suppression is available, and the profile Relay
  // generates really does disable every toolset it knows about.
  const profileDisablesEveryToolset = generatedProfileDisablesEveryToolset();
  const readOnlyEnforceable = helpAdvertisesFlag(help.text, TOOLSET_FLAG)
    && helpAdvertisesFlag(help.text, '--ignore-rules')
    && profileDisablesEveryToolset;

  const failureReason = (() => {
    if (parsedVersion === null) return 'Relay could not read a Hermes version from this runtime.';
    if (!compatible) {
      return `Hermes ${parsedVersion} is older than the minimum ${MINIMUM_HERMES_VERSION} this adapter requires.`;
    }
    if (missingFlags.length > 0) {
      return `This Hermes build does not expose ${missingFlags.join(', ')}, which the one-shot transport requires.`;
    }
    if (!profileDisablesEveryToolset) {
      return 'The Relay Reviewer profile does not disable every toolset it knows about.';
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
