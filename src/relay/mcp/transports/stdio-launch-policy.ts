/**
 * STDIO LAUNCH POLICY (PURE — no process, no filesystem, no SDK).
 *
 * Everything that DECIDES what may be launched lives here, separately from the
 * code that launches it. That split is deliberate: the decision is the security
 * boundary, and a security boundary that can only be tested by spawning
 * processes is a security boundary that ends up under-tested.
 *
 * THERE IS NO COMMAND STRING ANYWHERE IN THIS SUBSYSTEM. Not built, not
 * joined, not interpolated, not passed. An executable NAME and an argument
 * ARRAY go in, an executable name and an argument array come out, and the
 * spawn is `shell: false`. Shell injection is not defended against here — it is
 * unrepresentable, because there is no string for a shell to parse.
 *
 * THE ENVIRONMENT IS BUILT UP, NEVER FILTERED DOWN. `buildChildEnvironment`
 * starts from an EMPTY object and adds only what a registry entry allowlisted.
 * The alternative — copying `process.env` and deleting the dangerous keys — is
 * how every provider key, every `RELAY_*` secret and every CI token in the
 * parent ends up inside a third-party MCP server, because the delete list is
 * always shorter than reality. §8 requires that the parent environment is not
 * copied; this is that requirement expressed as code that cannot do otherwise.
 *
 * STDERR IS REDACTED BEFORE IT IS ANYTHING. A crashing server prints its
 * configuration, and its configuration contains its token. `redactStderr` runs
 * before stderr reaches a log, an evidence record, a connection note or an
 * error message, and it also bounds the volume — an MCP server in a crash loop
 * should not be able to fill a mission's evidence store.
 */

import { redactText } from '../policy/mcp-sanitize';
import type { McpStdioLaunchDefinition } from '../registry/mcp-registry-types';
import { validateStdioArguments } from '../registry/mcp-registry-types';

/**
 * THE EXECUTABLE ALLOWLIST.
 *
 * Only names on this list may ever be launched, and the list is a constant in
 * reviewed source rather than configuration. During private beta it contains
 * ONLY the offline fixture servers: §6 forbids arbitrary user-provided
 * commands, and Relay has curated no real stdio server yet. Adding a real one
 * is a source change that goes through review, which is the intended cost.
 *
 * An absolute path is never accepted — not as an allowlist entry and not as a
 * requested executable. A path is a filesystem fact that differs per machine;
 * a name is a policy decision that does not.
 */
export const MCP_ALLOWED_STDIO_EXECUTABLES: readonly string[] = Object.freeze([
  'relay-fixture-repository',
  'relay-fixture-documentation',
  'relay-fixture-database',
  'relay-fixture-revoked',
  'relay-fixture-scenario',
]);

/**
 * Environment variable names that may NEVER be forwarded to a child, even if a
 * registry entry allowlists them. A second, independent gate: the registry is
 * curated by a human, and humans allowlist `PATH` and then wonder how the
 * child found `~/.aws`.
 */
export const MCP_NEVER_FORWARDED_ENV_NAMES: readonly RegExp[] = Object.freeze([
  /API[_-]?KEY/i, /SECRET/i, /TOKEN/i, /PASSWORD/i, /PASSWD/i, /CREDENTIAL/i,
  /^AWS_/i, /^AZURE_/i, /^GOOGLE_/i, /^GCP_/i, /^ANTHROPIC_/i, /^OPENAI_/i,
  /^SUPABASE_/i, /^RAILWAY_/i, /^VERCEL_/i, /^GITHUB_/i, /^NPM_/i,
  /^RELAY_BRIDGE_/i, /^HERMES_/i, /PRIVATE[_-]?KEY/i, /^SSH_/i, /^GPG_/i,
]);

export interface McpStdioLaunchPlan {
  readonly executable: string;
  readonly args: readonly string[];
  /** The COMPLETE environment for the child. Built from empty. */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly startupTimeoutMs: number;
}

export type McpStdioLaunchDecision =
  | { readonly allowed: true; readonly plan: McpStdioLaunchPlan }
  | { readonly allowed: false; readonly category: 'executable_not_allowed' | 'argument_not_allowed' | 'environment_not_allowed'; readonly reason: string };

export interface McpStdioLaunchRequest {
  readonly definition: McpStdioLaunchDefinition;
  readonly additionalArguments: readonly string[];
  /** Credential material resolved server-side, keyed by env NAME. */
  readonly credentialEnvironment: Readonly<Record<string, string>>;
  /** Non-secret environment values Relay itself supplies (e.g. a scenario). */
  readonly relaySuppliedEnvironment: Readonly<Record<string, string>>;
  /** Resolved working directory. The caller proves it is an approved root. */
  readonly cwd: string;
  readonly startupTimeoutMs: number;
  /** Roots the cwd must sit within. Empty means "isolated temp only". */
  readonly approvedFilesystemRoots: readonly string[];
}

const isAbsolutePath = (value: string): boolean => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);

export function planStdioLaunch(request: McpStdioLaunchRequest): McpStdioLaunchDecision {
  const { definition } = request;

  /* --- executable --- */
  if (isAbsolutePath(definition.executable) || definition.executable.includes('/') || definition.executable.includes('\\')) {
    return {
      allowed: false,
      category: 'executable_not_allowed',
      reason: 'an MCP executable must be an allowlisted NAME, never a path',
    };
  }
  if (!MCP_ALLOWED_STDIO_EXECUTABLES.includes(definition.executable)) {
    return {
      allowed: false,
      category: 'executable_not_allowed',
      reason: `"${definition.executable}" is not on the Relay stdio executable allowlist`,
    };
  }

  /* --- arguments --- */
  const argumentCheck = validateStdioArguments(definition, request.additionalArguments);
  if (!argumentCheck.ok) {
    return { allowed: false, category: 'argument_not_allowed', reason: argumentCheck.reason };
  }
  for (const argument of argumentCheck.args) {
    // Shell metacharacters cannot do anything under `shell: false`, but an
    // argument carrying them is a sign the caller believes it is building a
    // command line. Refusing is cheap and removes the ambiguity entirely.
    if (/[;&|`$><\n\r]/.test(argument)) {
      return {
        allowed: false,
        category: 'argument_not_allowed',
        reason: 'an argument contains shell metacharacters — Relay never builds a command string, and an argument shaped like one is refused',
      };
    }
  }

  /* --- filesystem root --- */
  if (request.approvedFilesystemRoots.length > 0) {
    const within = request.approvedFilesystemRoots.some((root) => request.cwd === root || request.cwd.startsWith(`${root}/`));
    if (!within) {
      return {
        allowed: false,
        category: 'environment_not_allowed',
        reason: 'the working directory is outside every approved filesystem root',
      };
    }
  }

  /* --- environment --- */
  const env = buildChildEnvironment({
    allowlist: definition.environmentAllowlist,
    credentialEnvironment: request.credentialEnvironment,
    relaySuppliedEnvironment: request.relaySuppliedEnvironment,
  });
  if (!env.ok) {
    return { allowed: false, category: 'environment_not_allowed', reason: env.reason };
  }

  return {
    allowed: true,
    plan: {
      executable: definition.executable,
      args: argumentCheck.args,
      env: env.env,
      cwd: request.cwd,
      startupTimeoutMs: request.startupTimeoutMs,
    },
  };
}

/**
 * Builds the child environment FROM EMPTY.
 *
 * `process.env` is never read here — this function has no access to it and
 * takes no parameter that could carry it. A caller wanting to forward a parent
 * variable must name it in a registry allowlist AND supply its value
 * explicitly, and the never-forward patterns still apply on top.
 */
export function buildChildEnvironment(input: {
  readonly allowlist: readonly string[];
  readonly credentialEnvironment: Readonly<Record<string, string>>;
  readonly relaySuppliedEnvironment: Readonly<Record<string, string>>;
}): { readonly ok: true; readonly env: Readonly<Record<string, string>> } | { readonly ok: false; readonly reason: string } {
  const env: Record<string, string> = Object.create(null);
  const allowed = new Set(input.allowlist);

  const offer = (name: string, value: string, source: string): string | null => {
    if (!allowed.has(name)) {
      return `${source} supplies ${name}, which this registry entry does not allowlist`;
    }
    if (MCP_NEVER_FORWARDED_ENV_NAMES.some((pattern) => pattern.test(name))) {
      // A credential DOES legitimately carry a secret-shaped name — that is
      // what it is. The never-forward gate applies to Relay-supplied
      // variables, where such a name means a parent secret is leaking.
      if (source !== 'the credential resolver') {
        return `${name} matches a never-forwarded pattern and cannot be passed to a child process`;
      }
    }
    env[name] = value;
    return null;
  };

  for (const [name, value] of Object.entries(input.relaySuppliedEnvironment)) {
    const problem = offer(name, value, 'Relay');
    if (problem !== null) return { ok: false, reason: problem };
  }
  for (const [name, value] of Object.entries(input.credentialEnvironment)) {
    const problem = offer(name, value, 'the credential resolver');
    if (problem !== null) return { ok: false, reason: problem };
  }

  return { ok: true, env: Object.freeze({ ...env }) };
}

/* ------------------------------------------------------------------ *
 * stderr handling.
 * ------------------------------------------------------------------ */

export const MCP_STDERR_MAXIMUM_BYTES = 8 * 1024;
export const MCP_STDERR_MAXIMUM_LINES = 40;

export interface McpRedactedStderr {
  readonly text: string;
  readonly truncated: boolean;
  readonly redactionsApplied: number;
}

/**
 * Bounds and redacts child stderr. Both, always, in that order — bounding
 * first would let a secret sit inside the kept prefix; redacting first and
 * bounding second is what this does.
 */
export function redactStderr(raw: string): McpRedactedStderr {
  const redacted = redactText(raw, { redactPaths: true });
  const lines = redacted.text.split('\n');
  let truncated = false;
  let text = redacted.text;
  if (lines.length > MCP_STDERR_MAXIMUM_LINES) {
    text = lines.slice(0, MCP_STDERR_MAXIMUM_LINES).join('\n');
    truncated = true;
  }
  const encoded = new TextEncoder().encode(text);
  if (encoded.length > MCP_STDERR_MAXIMUM_BYTES) {
    text = new TextDecoder().decode(encoded.slice(0, MCP_STDERR_MAXIMUM_BYTES));
    truncated = true;
  }
  return { text, truncated, redactionsApplied: redacted.redactionsApplied };
}

/**
 * Does this stdout line look like JSON-RPC at all?
 *
 * A server that prints a banner, a warning or a stack trace to STDOUT has
 * corrupted the protocol channel. Relay classifies that as `non_mcp_stdout`
 * rather than `malformed_response`, because the operator action is different:
 * one is "this server is broken", the other is "this server is not an MCP
 * server".
 */
export function looksLikeJsonRpc(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true; // blank lines are harmless framing
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && 'jsonrpc' in (parsed as Record<string, unknown>);
  } catch {
    return false;
  }
}
