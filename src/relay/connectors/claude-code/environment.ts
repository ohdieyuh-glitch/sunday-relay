/**
 * Environment filtering (Prompt 8) — PURE. Builds the minimum environment a
 * locally-authenticated Claude Code process needs, and strips every
 * provider-credential and third-party-provider variable so nothing billed
 * or secret is inherited. The local-subscription profile relies on Claude's
 * own OAuth (keychain / ~/.claude), never on env credentials, so removing
 * these cannot break approved auth.
 */

/** Variables that force API-billed or third-party execution — always removed. */
const STRIPPED_EXACT = new Set([
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'AWS_BEARER_TOKEN_BEDROCK',
]);

/** Name patterns that never reach the child (secrets, third-party creds). */
const STRIPPED_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE|OPENAI|SUPABASE|GEMINI|GOOGLE_API|AWS_ACCESS|AWS_SECRET|AWS_SESSION|GH_|GITHUB_|NPM_TOKEN|VERCEL|RAILWAY|CLOUDFLARE)/i;

/** Base variables a local Claude process needs to run. */
const PASSTHROUGH = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TZ', 'TMPDIR', 'TEMP', 'TMP', 'TERM', 'COLUMNS', 'LINES',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'SYSTEMROOT',
];

export interface FilteredEnvironment {
  env: Record<string, string>;
  /** Names granted (never values) — for redacted reporting. */
  grantedKeys: string[];
  /** Names removed because they matched a credential rule — names only. */
  strippedKeys: string[];
}

export function buildClaudeEnvironment(
  baseEnv: Record<string, string | undefined> = process.env,
): FilteredEnvironment {
  const env: Record<string, string> = {};
  const grantedKeys: string[] = [];
  const strippedKeys: string[] = [];

  for (const key of PASSTHROUGH) {
    const value = baseEnv[key];
    if (value !== undefined && !STRIPPED_EXACT.has(key) && !STRIPPED_PATTERN.test(key)) {
      env[key] = value;
      grantedKeys.push(key);
    }
  }
  // Report what was present-and-stripped so doctor can say "API key
  // detected: yes/no" by NAME without ever reading the value.
  for (const key of Object.keys(baseEnv)) {
    if (STRIPPED_EXACT.has(key) || STRIPPED_PATTERN.test(key)) strippedKeys.push(key);
  }
  // Belt-and-suspenders: mark subscription auth and disable telemetry noise.
  env.CLAUDE_CODE_NONINTERACTIVE = '1';
  return { env, grantedKeys, strippedKeys };
}

/** True when an API-key / third-party provider variable is present by name. */
export function apiKeyEnvironmentDetected(baseEnv: Record<string, string | undefined> = process.env): boolean {
  return (
    baseEnv.ANTHROPIC_API_KEY !== undefined ||
    baseEnv.ANTHROPIC_AUTH_TOKEN !== undefined ||
    baseEnv.CLAUDE_CODE_USE_BEDROCK !== undefined ||
    baseEnv.CLAUDE_CODE_USE_VERTEX !== undefined ||
    baseEnv.ANTHROPIC_BASE_URL !== undefined
  );
}
