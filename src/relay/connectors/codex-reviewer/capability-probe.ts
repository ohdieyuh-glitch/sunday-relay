import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type {
  CodexAuthClassification, CodexAuthStatus, CodexReviewerCapabilityProfile, CodexRuntimeStrategy,
} from './contracts';
import { apiKeyEnvironmentDetected, buildCodexEnvironment } from './environment';

/**
 * Codex Reviewer capability probe (Prompt 8.3) — READ-ONLY, NO model call.
 * Mirrors the Claude probe: resolve the executable, read `--version` and
 * `exec --help`, and classify login readiness via `codex login status`. It
 * distinguishes an installed binary from a ready login, and documented flags
 * from confirmed ones. It never reads credential files or prints credential
 * material, and it never infers a successful login merely from the binary
 * existing.
 */

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_MAX_BUFFER = 4 * 1024 * 1024;

/** The ONE canonical child environment for every Codex probe: the safe
 * runtime + home-directory variables (PATH, HOME, USER, LOGNAME, LANG, TERM,
 * TMPDIR, XDG_*, CODEX_HOME) with explicit provider credentials stripped. This
 * reuses the exact filtering used to launch the review, so there is a single
 * environment policy. Home/XDG vars are preserved so `login status` can read
 * the (unmodified) local login state. */
function safeChildEnv(): Record<string, string> {
  return buildCodexEnvironment(process.env).env;
}

const ANSI = new RegExp('\\u001b\\[[0-9;]*m', 'g');

/** Redact anything account/secret-shaped and strip ANSI before a probe string
 * is ever inspected or logged — we never keep the raw text. */
function sanitize(text: string): string {
  return text
    .replace(ANSI, '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-account>')
    .replace(/(sk-|eyJ|codex_|ya29\.)[A-Za-z0-9._-]{6,}/g, '<redacted-secret>');
}

function tryExec(executable: string, args: string[]): string | null {
  try {
    return execFileSync(executable, args, {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_MAX_BUFFER,
      env: safeChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

export interface CodexLoginProbe {
  exitCode: number | null;
  /** Sanitized (secret/email-redacted, ANSI-stripped) COMBINED stdout+stderr —
   * `codex login status` prints its result to stderr, so both must be read. */
  text: string;
}

/** THE canonical Codex login probe (shell:false, both streams, sanitized). No
 * provider/model call — this is a local login-state check. It never reads
 * credential storage directly and never returns raw credential material. */
export function probeCodexLoginStatus(executablePath: string): CodexLoginProbe {
  const res = spawnSync(executablePath, ['login', 'status'], {
    encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER,
    env: safeChildEnv(), stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  });
  const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  return { exitCode: typeof res.status === 'number' ? res.status : null, text: sanitize(combined) };
}

const NOT_LOGGED_IN = /(not logged in|not signed in|no (stored )?credentials|please (run )?(codex )?login|run\s+`?codex login`?)/;
const LOGGED_IN = /(logged in|signed in|authenticated)/;

/** Pure classifier over a login probe result. Requires exit 0 + a logged-in
 * phrase for `ready`; explicit not-logged-in output is `not_ready`; unknown
 * exit-0 output is `unverified` (never `not_ready`); a non-zero exit is never
 * `ready`. Whitespace and case are normalized; text is already ANSI-free. */
export function classifyCodexLoginOutput(input: { exitCode: number | null; text: string }): {
  status: Extract<CodexAuthStatus, 'ready' | 'not_ready' | 'unverified'>;
  loggedIn: boolean;
  methodLabel: string;
} {
  const normalized = input.text.replace(new RegExp('\\u001b\\[[0-9;]*m', 'g'), '').replace(/\s+/g, ' ').trim().toLowerCase();
  const notLoggedIn = NOT_LOGGED_IN.test(normalized);
  const loggedInPhrase = LOGGED_IN.test(normalized) && !notLoggedIn;

  let status: 'ready' | 'not_ready' | 'unverified';
  if (input.exitCode === 0) {
    status = loggedInPhrase ? 'ready' : notLoggedIn ? 'not_ready' : 'unverified';
  } else {
    // A non-zero exit is never ready: explicit not-logged-in → not_ready,
    // anything else (incl. logged-in-looking text on failure) → unverified.
    status = notLoggedIn ? 'not_ready' : 'unverified';
  }
  const methodLabel = /chatgpt/.test(normalized) ? 'chatgpt'
    : /api[ _-]?key/.test(normalized) ? 'api'
      : status === 'ready' ? 'local' : 'unknown';
  return { status, loggedIn: status === 'ready', methodLabel };
}

export function resolveCodexExecutable(explicit?: string): string | null {
  if (explicit) {
    try {
      return existsSync(explicit) ? realpathSync(explicit) : null;
    } catch {
      return null;
    }
  }
  const pathVar = process.env.PATH ?? '';
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex'];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return realpathSync(candidate);
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

/** Choose the safest supported automation strategy. exec_structured_review is
 * preferred because the native `codex exec review` subcommand lacks --json,
 * --output-schema, --sandbox, --cd, and --output-last-message on this CLI, so
 * it cannot provide structured output, session identity, or a read-only
 * sandbox — we never sacrifice those to use the native subcommand. */
export function selectRuntimeStrategy(
  caps: Omit<CodexReviewerCapabilityProfile, 'selectedRuntimeStrategy'>,
): CodexRuntimeStrategy {
  if (
    caps.nonInteractiveExecSupported && caps.jsonEventsSupported &&
    caps.readOnlySandboxSupported && caps.outputLastMessageSupported
  ) {
    return 'exec_structured_review';
  }
  if (caps.nativeReviewSupported) return 'native_review';
  return 'unavailable';
}

export function probeCodexCapabilities(now: string, explicitPath?: string): CodexReviewerCapabilityProfile {
  const executablePath = resolveCodexExecutable(explicitPath);
  const version = executablePath ? (tryExec(executablePath, ['--version']) ?? '').trim().split(/\s+/).pop() ?? null : null;
  const execHelp = executablePath ? (tryExec(executablePath, ['exec', '--help']) ?? '') : '';
  const reviewHelp = executablePath ? (tryExec(executablePath, ['exec', 'review', '--help']) ?? '') : '';
  const topHelp = executablePath ? (tryExec(executablePath, ['--help']) ?? '') : '';

  const has = (help: string, ...flags: string[]): boolean => flags.some((f) => help.includes(f));

  const auth = classifyCodexAuth(now, executablePath);

  const base = {
    executablePath,
    version: version || null,
    nonInteractiveExecSupported: !!executablePath && has(topHelp, ' exec ', 'exec ') || has(topHelp, 'Run Codex non-interactively'),
    jsonEventsSupported: has(execHelp, '--json'),
    outputSchemaSupported: has(execHelp, '--output-schema'),
    outputLastMessageSupported: has(execHelp, '--output-last-message'),
    exactResumeSupported: has(execHelp, 'resume') && has(topHelp, 'resume'),
    nativeReviewSupported: has(topHelp, 'review') && !!reviewHelp,
    uncommittedReviewSupported: has(reviewHelp, '--uncommitted'),
    baseReviewSupported: has(reviewHelp, '--base'),
    commitReviewSupported: has(reviewHelp, '--commit'),
    readOnlySandboxSupported: has(execHelp, 'read-only'),
    workspaceWriteSandboxSupported: has(execHelp, 'workspace-write'),
    ignoreUserConfigSupported: has(execHelp, '--ignore-user-config'),
    ignoreRulesSupported: has(execHelp, '--ignore-rules'),
    strictConfigSupported: has(execHelp, '--strict-config'),
    cancellationSupported: true,
    authenticationStatus: auth.status as CodexAuthStatus,
    probedAt: now,
    provenance: 'live' as const,
  };
  return { ...base, selectedRuntimeStrategy: selectRuntimeStrategy(base) };
}

/** Classify local Codex login readiness via the ONE canonical login probe — a
 * safe, no-model-call diagnostic used identically by `relay codex doctor`, the
 * Gate-B preflight, live-launch eligibility, and Manual Task verification.
 * NEVER stores or returns the account email/token: only a boolean + coarse
 * label. An explicit API-key ENV source (by name) classifies as `api_key`
 * (disallowed for the local-login profile) — a STORED ChatGPT/local login is
 * the approved `codex_local_login` and classifies as `ready`. */
export function classifyCodexAuth(now: string, executablePath: string | null): CodexAuthClassification {
  const executablePresent = !!executablePath;
  if (apiKeyEnvironmentDetected(process.env)) {
    return {
      executablePresent, loggedIn: false, status: 'api_key', approvedForLiveReview: false,
      methodLabel: 'api', classifiedAt: now,
    };
  }
  if (!executablePath) {
    return {
      executablePresent: false, loggedIn: false, status: 'unverified', approvedForLiveReview: false,
      methodLabel: 'unknown', classifiedAt: now,
    };
  }
  const probe = probeCodexLoginStatus(executablePath);
  const c = classifyCodexLoginOutput(probe);
  return {
    executablePresent: true,
    loggedIn: c.loggedIn,
    status: c.status,
    approvedForLiveReview: c.status === 'ready',
    methodLabel: c.methodLabel,
    classifiedAt: now,
  };
}
