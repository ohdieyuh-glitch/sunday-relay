/**
 * Codex Reviewer environment filtering (Prompt 8.3) — PURE (no Node imports).
 *
 * The Reviewer uses the user's EXISTING local Codex login. Relay never reads,
 * stores, copies, or prints the credential. We strip explicit provider-key /
 * gateway / base-URL sources from the child environment so a review can never
 * be billed against an injected API key or redirected to a custom endpoint,
 * while preserving the minimum non-secret runtime paths the local Codex
 * executable and its login need (PATH, HOME, CODEX_HOME, XDG dirs, …).
 */

// EXACT-match names always removed from the child environment.
const STRIPPED_EXACT = new Set([
  'OPENAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT_ID',
  'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_API_TYPE',
  'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_AD_TOKEN',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'CODEX_BASE_URL',
]);

// Pattern denylist (case-insensitive) — any matching name is stripped.
const STRIPPED_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE|OPENAI|AZURE_OPENAI|ANTHROPIC|GEMINI|GOOGLE_API|AWS_ACCESS|AWS_SECRET|AWS_SESSION|GH_|GITHUB_|NPM_TOKEN|VERCEL|RAILWAY|CLOUDFLARE|GATEWAY|BASE_URL)/i;

// Allowlist of names copied into the child env. CODEX_HOME is preserved so
// the EXISTING local login continues to work (auth still uses CODEX_HOME);
// it is a directory path, not a secret value.
const PASSTHROUGH = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TZ', 'TMPDIR', 'TEMP', 'TMP', 'TERM', 'COLUMNS', 'LINES',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  'SYSTEMROOT', 'CODEX_HOME',
];

/** Names whose mere PRESENCE indicates an explicit API-key / gateway source
 * that must trigger a Manual Task instead of an automatic launch. */
const API_KEY_SOURCE_NAMES = [
  'OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE',
  'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'CODEX_BASE_URL', 'AWS_ACCESS_KEY_ID',
];

export interface FilteredEnvironment {
  env: Record<string, string>;
  /** Names granted (never values). */
  grantedKeys: string[];
  /** Names present-and-stripped (names only, never values). */
  strippedKeys: string[];
}

export function buildCodexEnvironment(
  baseEnv: Record<string, string | undefined> = {},
): FilteredEnvironment {
  const env: Record<string, string> = {};
  const grantedKeys: string[] = [];
  const strippedKeys: string[] = [];

  const isStripped = (name: string): boolean =>
    STRIPPED_EXACT.has(name) || STRIPPED_PATTERN.test(name);

  for (const name of PASSTHROUGH) {
    const value = baseEnv[name];
    if (value != null && value !== '' && !isStripped(name)) {
      env[name] = value;
      grantedKeys.push(name);
    }
  }
  // Record every stripped name that was actually present (names only).
  for (const name of Object.keys(baseEnv)) {
    if (baseEnv[name] != null && isStripped(name)) strippedKeys.push(name);
  }
  return { env, grantedKeys, strippedKeys };
}

/** True when an explicit provider API-key / gateway / base-URL source is
 * present by NAME (never the value). Such a source must not launch
 * automatically — Relay raises a Manual Task explaining that the profile uses
 * the existing local Codex login, not an injected key. */
export function apiKeyEnvironmentDetected(
  baseEnv: Record<string, string | undefined> = {},
): boolean {
  return API_KEY_SOURCE_NAMES.some((name) => baseEnv[name] != null && baseEnv[name] !== '');
}
