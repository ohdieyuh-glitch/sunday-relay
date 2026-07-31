/**
 * YC demo preflight (Prompt 8.7) — a PURE engine over injected dependencies.
 * It verifies the founder can record the YC demo from this checkout: branch,
 * checkpoint, tree status, build + script availability, the offline plain
 * demo, terminal capabilities, and required documentation. It reads the
 * repository read-only (no repo or user-state writes; the injected offline
 * plain-demo uses an isolated, self-deleting temp state root), makes zero
 * provider calls and zero network calls, and it NEVER inspects the browser
 * surface. That surface lives in this repository (`src/relay/ui/`, built by
 * `npm run build`), but nothing here opens a browser, serves a page or reads a
 * rendered route — so the frontend is always reported as MANUAL VERIFICATION
 * REQUIRED rather than claimed as checked. This module imports nothing — every
 * effect arrives through {@link YcPreflightDeps}.
 */

/**
 * Post-separation re-anchoring.
 *
 * This check used to pin an expected branch name and a minimum commit SHA.
 * Both named the pre-separation ALCATRAZ branch and a commit that exists only
 * in the Alcatraz object store, so after Sunday Relay became its own
 * repository the check could never pass here — and it asserted nothing about
 * the product anyway. (The exact retired values are recorded in
 * docs/relay/YC_DEMO_RUNBOOK.md, not carried in this engine.)
 *
 * Readiness is now a statement about the PRODUCT and the REPOSITORY IDENTITY:
 * the checkout is the independent Relay repository, the required product
 * surfaces exist, the capability baseline is met, and the demo is offline and
 * truthful. Nothing is branch-specific, so the check behaves identically on
 * `main`, on any `relay/*` branch, and on a detached CI head — and it FAILS in
 * the Alcatraz repository, which is the property the old branch pin was
 * reaching for.
 *
 * The baseline itself is versioned data, not code: {@link YC_BASELINE_PATH}.
 */

/** Versioned product-baseline document read at preflight time. */
export const YC_BASELINE_PATH = 'docs/relay/YC_DEMO_BASELINE.json';
/** Schema version this engine understands. */
export const YC_BASELINE_SCHEMA_VERSION = 1;

/** Canonical Relay repository, and the sibling product that must never
 * masquerade as it. Compiled in as the last line of defence so a baseline
 * document cannot quietly re-point identity at another repository. */
export const YC_EXPECTED_REPOSITORY = 'ohdieyuh-glitch/sunday-relay';
export const YC_FORBIDDEN_REPOSITORIES = ['ohdieyuh-glitch/turbo-broccoli'] as const;

export interface YcBaseline {
  schemaVersion: number;
  product: string;
  repository: { expectedNameWithOwner: string; forbiddenNamesWithOwner: string[] };
  requiredCapabilityIds: string[];
  requiredFiles: Record<string, string[]>;
  requiredChecks?: string[];
  demoDisclosure: { labels: string[]; completionLine: string };
}

/** `https://github.com/owner/repo.git`, `git@github.com:owner/repo.git`,
 * `ssh://git@github.com/owner/repo` → `owner/repo`. Returns null when the
 * remote is absent or unparseable — an unknown origin is never a pass. */
export function repositorySlug(remoteUrl: string): string | null {
  const raw = remoteUrl.trim();
  if (raw === '') return null;
  const withoutScheme = raw
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/\.git$/i, '');
  const path = withoutScheme.includes(':') && !withoutScheme.startsWith('/')
    ? withoutScheme.slice(withoutScheme.indexOf(':') + 1)
    : withoutScheme.replace(/^[^/]+\//, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export const YC_REQUIRED_SCRIPTS = [
  'relay:cli:demo', 'relay:cli:demo:plain', 'relay:cli:contract-verify',
  'relay:yc-demo:check', 'relay:yc-demo:cli',
] as const;

export const YC_REQUIRED_DOCS = [
  'docs/relay/YC_DEMO_RUNBOOK.md',
  'docs/relay/RELAY_CLI_PRODUCT.md',
  'docs/relay/CLI.md',
  'docs/relay/LIVE_TERMINAL.md',
  'docs/relay/RELAY_DOG.md',
  'docs/relay/TEST_STRATEGY.md',
  'docs/relay/SECURITY_BOUNDARIES.md',
  'docs/relay/CURRENT_STATE.md',
  'docs/relay/SESSION_LOG.md',
  'docs/relay/COMPETITIVE_FEATURE_COVERAGE.md',
] as const;

/** Proof records the preflight reports on (existence-checked, never parsed). */
export const YC_PROOF_DOCS = [
  { label: 'Real Claude implementation proof', doc: 'docs/relay/SUPERVISED_WORKFLOW.md', phase: 'Prompt 8.4' },
  { label: 'Real Codex review proof', doc: 'docs/relay/LIVE_CODEX_REVIEW.md', phase: 'Prompt 8.3/8.4' },
  { label: 'Durable recovery', doc: 'docs/relay/DURABLE_LOCAL_PERSISTENCE.md', phase: 'Prompt 8.5' },
  { label: 'CLI product', doc: 'docs/relay/RELAY_CLI_PRODUCT.md', phase: 'Prompt 8.6' },
] as const;

/** Labels the offline demo must show (mirrors the product DEMO_LABELS —
 * duplicated here so this module stays import-free and the acceptance tests
 * assert the two stay in sync). */
export const YC_DEMO_LABELS = ['OFFLINE DEMO', 'VISUAL SIMULATION', 'FAKE ADAPTERS', 'NO PROVIDER CALLS'] as const;

/** Honesty notice printed by `relay yc demo` BEFORE the simulation starts. */
export function ycDemoNotice(unicode: boolean): string[] {
  const sep = unicode ? ' · ' : ' / ';
  return [
    'SUNDAY RELAY — YC DEMO LAUNCHER',
    YC_DEMO_LABELS.join(sep) + sep + 'NO REAL FILE CHANGES',
    'This starts the founder-approved OFFLINE visual simulation only:',
    'fixture events, fake adapters, zero provider calls, zero network calls,',
    'and no real project is modified. The real Claude-to-Codex supervised',
    'workflow was proven separately (Prompt 8.4); durable crash recovery in',
    'Prompt 8.5. Starting the simulation…',
    '',
  ];
}

export interface YcGitResult { ok: boolean; stdout: string }

export interface YcPreflightDeps {
  /** Read-only git (rev-parse / status / merge-base only). */
  runGit(args: readonly string[]): YcGitResult;
  /** Existence check for a REPO-RELATIVE path (never absolute, never outside
   * this checkout). */
  fileExists(relPath: string): boolean;
  /** Read a repo-relative text file, or null. */
  readTextFile(relPath: string): string | null;
  env: Record<string, string | undefined>;
  columns: number | undefined;
  /** Runs the offline plain demo IN-PROCESS (no subprocess, no provider). */
  runPlainDemo(): Promise<{ lines: string[]; exitCode: number }>;
}

export type YcCheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO' | 'MANUAL';
export interface YcCheck { name: string; status: YcCheckStatus; detail?: string }
export interface YcPreflightReport { lines: string[]; checks: YcCheck[]; exitCode: number }

/** Secret / identity shapes to redact from any value that reaches the
 * report. Duplicated (not imported) so this engine stays import-free — the
 * same discipline as YC_DEMO_LABELS. Mirrors cli/product/safety.ts. */
// eslint-disable-next-line no-control-regex
const SECRET_SHAPE = /(sk-[A-Za-z0-9]{8,})|(AKIA[0-9A-Z]{12,})|(-----BEGIN [A-Z ]*PRIVATE KEY)|(gh[pousr]_[A-Za-z0-9]{20,})|(xox[baprs]-[A-Za-z0-9-]{10,})|(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;
const UUID_SHAPE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const EMAIL_SHAPE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** Absolute POSIX paths (≥2 segments) — collapse to `…/<basename>` so an fs
 * error message can never leak a home directory or username. */
const ABS_PATH = /(?:\/[\w.@-]+){2,}\/?/g;

/** Printable-ASCII scrub for values that came from the environment (branch
 * names, git output, thrown fs-error messages) — the preflight never prints
 * control bytes, secret shapes, session ids, emails, or absolute paths. */
function scrub(value: string, maxLength = 80): string {
  let clean = value.replace(/[^\x20-\x7e]/g, ' ');
  clean = clean.replace(SECRET_SHAPE, '[redacted]');
  clean = clean.replace(UUID_SHAPE, '[session-ref]');
  clean = clean.replace(EMAIL_SHAPE, '[masked-email]');
  clean = clean.replace(ABS_PATH, (m) => `…/${m.replace(/\/$/, '').split('/').pop() ?? ''}`);
  clean = clean.replace(/\s{2,}/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}~` : clean;
}

export async function runYcPreflight(deps: YcPreflightDeps): Promise<YcPreflightReport> {
  const checks: YcCheck[] = [];
  const add = (name: string, status: YcCheckStatus, detail?: string): YcCheck => {
    const check: YcCheck = { name, status, detail };
    checks.push(check);
    return check;
  };
  const stamp = (check: YcCheck): string => `[${check.status}]`;
  const row = (label: string, value: string, check?: YcCheck): string =>
    `  ${`${label}: ${value}`.padEnd(56)}${check ? ` ${stamp(check)}` : ''}`;

  /* ---------------------------- repository --------------------------- */
  // IDENTITY, not branch. Passing depends on being in the independent Relay
  // repository — never on which branch is checked out, so `main`, `relay/*`
  // and a detached CI head all behave identically.
  const remote = deps.runGit(['remote', 'get-url', 'origin']);
  const slug = remote.ok ? repositorySlug(remote.stdout) : null;
  const forbiddenHit = slug !== null && YC_FORBIDDEN_REPOSITORIES.includes(slug as typeof YC_FORBIDDEN_REPOSITORIES[number]);
  const repoCheck = add('repository-identity',
    slug === YC_EXPECTED_REPOSITORY ? 'PASS' : 'FAIL',
    slug === YC_EXPECTED_REPOSITORY
      ? `origin is ${YC_EXPECTED_REPOSITORY}`
      : forbiddenHit
        ? `origin is ${scrub(slug ?? '')} — that is Sunday Alcatraz, a different product. Run this from the Relay repository.`
        : `origin is ${slug === null ? '(no origin remote)' : scrub(slug)}, expected ${YC_EXPECTED_REPOSITORY}`);

  const head = deps.runGit(['rev-parse', '--short', 'HEAD']);
  const headShort = head.ok ? scrub(head.stdout, 16) : '(unknown)';
  const branch = deps.runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branchName = branch.ok ? scrub(branch.stdout) : '(unknown)';
  // Reported, never gated: a detached CI head is a normal place to run this.
  const branchCheck = add('checkout', 'INFO',
    branchName === 'HEAD'
      ? `detached HEAD at ${headShort} — readiness is branch-independent`
      : `${branchName} at ${headShort} — readiness is branch-independent`);

  /* -------------------------- product baseline ----------------------- */
  const baselineRaw = deps.readTextFile(YC_BASELINE_PATH);
  let baseline: YcBaseline | null = null;
  try { baseline = baselineRaw ? (JSON.parse(baselineRaw) as YcBaseline) : null; } catch { baseline = null; }

  const baselineCheck = ((): YcCheck => {
    if (baseline === null) return add('product-baseline', 'FAIL', `${YC_BASELINE_PATH} missing or unparseable`);
    if (baseline.schemaVersion !== YC_BASELINE_SCHEMA_VERSION) {
      return add('product-baseline', 'FAIL',
        `baseline schemaVersion ${scrub(String(baseline.schemaVersion), 12)}, this check understands ${YC_BASELINE_SCHEMA_VERSION}`);
    }
    // A baseline may tighten identity but never re-point it at another repo.
    if (baseline.repository?.expectedNameWithOwner !== YC_EXPECTED_REPOSITORY) {
      return add('product-baseline', 'FAIL', 'baseline names a different repository than the compiled-in Relay identity');
    }
    const groups = Object.entries(baseline.requiredFiles ?? {});
    const missing = groups.flatMap(([group, paths]) =>
      (paths ?? []).filter((p) => !deps.fileExists(p)).map((p) => `${group}:${p}`));
    if (missing.length > 0) {
      return add('product-baseline', 'FAIL', `${missing.length} required product file(s) missing: ${scrub(missing.join(', '), 120)}`);
    }
    const fileCount = groups.reduce((n, [, paths]) => n + (paths ?? []).length, 0);
    return add('product-baseline', 'PASS', `${fileCount} required product files present across ${groups.length} surfaces`);
  })();

  /* ------------------------ capability baseline ---------------------- */
  const capabilityCheck = ((): YcCheck => {
    const required = baseline?.requiredCapabilityIds ?? [];
    if (required.length === 0) return add('surface-parity-registry', 'FAIL', 'baseline lists no required capabilities');
    const registryRaw = deps.readTextFile('src/relay/parity/relay-surface-capabilities.json');
    if (registryRaw === null) return add('surface-parity-registry', 'FAIL', 'website/CLI capability registry missing');
    let ids: string[] = [];
    let manifestVersion = '(unknown)';
    try {
      const parsed = JSON.parse(registryRaw) as { manifestVersion?: string; capabilities?: Array<{ capabilityId?: string }> };
      manifestVersion = typeof parsed.manifestVersion === 'string' ? parsed.manifestVersion : '(unknown)';
      ids = (parsed.capabilities ?? []).map((c) => c.capabilityId ?? '').filter(Boolean);
    } catch {
      return add('surface-parity-registry', 'FAIL', 'capability registry is not valid JSON');
    }
    const present = new Set(ids);
    const absent = required.filter((id) => !present.has(id));
    return absent.length === 0
      ? add('surface-parity-registry', 'PASS', `${required.length}/${required.length} baseline capabilities in registry v${scrub(manifestVersion, 16)}`)
      : add('surface-parity-registry', 'FAIL', `missing capabilities: ${scrub(absent.join(', '), 120)}`);
  })();

  const status = deps.runGit(['status', '--porcelain']);
  const dirtyCount = status.ok ? status.stdout.split('\n').filter((l) => l.trim().length > 0).length : -1;
  const treeCheck = !status.ok
    ? add('working-tree', 'FAIL', 'git status failed')
    : dirtyCount === 0
      ? add('working-tree', 'PASS', 'clean')
      : add('working-tree', 'WARN',
        `${dirtyCount} uncommitted change(s) — expected during Prompt 8.7 acceptance; nothing is modified or deleted by this check`);

  /* ------------------------- build + scripts ------------------------- */
  const buildCheck = add('relay-build', deps.fileExists('dist-relay/cli.cjs') ? 'PASS' : 'FAIL',
    deps.fileExists('dist-relay/cli.cjs') ? 'dist-relay/cli.cjs present' : 'run: npm run relay:build');

  const packageJson = deps.readTextFile('package.json');
  let scripts: Record<string, string> = {};
  try {
    scripts = packageJson ? ((JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {}) : {};
  } catch { scripts = {}; }
  const missingScripts = YC_REQUIRED_SCRIPTS.filter((name) => typeof scripts[name] !== 'string');
  const scriptsCheck = add('demo-scripts', missingScripts.length === 0 ? 'PASS' : 'FAIL',
    missingScripts.length === 0 ? `${YC_REQUIRED_SCRIPTS.length} npm commands available`
      : `missing npm script(s): ${missingScripts.join(', ')}`);

  /* --------------------------- plain demo ---------------------------- */
  let demoCheck: YcCheck;
  let demoOutput = '';
  try {
    const demo = await deps.runPlainDemo();
    demoOutput = demo.lines.join('\n');
    const missingLabels = YC_DEMO_LABELS.filter((label) => !demoOutput.includes(label));
    const completes = demoOutput.includes('Mission verified complete.');
    demoCheck = demo.exitCode === 0 && missingLabels.length === 0 && completes
      ? add('plain-demo', 'PASS', 'exit 0, offline labels present, reaches VERIFIED COMPLETE')
      : add('plain-demo', 'FAIL',
        demo.exitCode !== 0 ? `plain demo exited ${demo.exitCode}`
          : missingLabels.length > 0 ? `missing labels: ${missingLabels.join(', ')}`
            : 'plain demo never reaches Mission verified complete');
  } catch (err) {
    demoCheck = add('plain-demo', 'FAIL', `plain demo threw: ${scrub(String((err as Error)?.message ?? err))}`);
  }

  /* ---------------------------- terminal ----------------------------- */
  const width = deps.columns;
  const widthCheck = width === undefined
    ? add('terminal-width', 'INFO', 'unknown (not a TTY) — the plain walkthrough still works')
    : width >= 80
      ? add('terminal-width', 'PASS', `${width} columns`)
      : add('terminal-width', 'WARN', `${width} columns — maximize the terminal, or press V for the linear stream view`);
  const noColor = deps.env.NO_COLOR !== undefined;
  const colorCheck = add('color', 'INFO', noColor ? 'NO_COLOR set — monochrome output (still fully labeled)' : 'color enabled (NO_COLOR not set)');

  /* ----------------------------- docs -------------------------------- */
  const missingDocs = YC_REQUIRED_DOCS.filter((doc) => !deps.fileExists(doc));
  const docsCheck = add('documentation', missingDocs.length === 0 ? 'PASS' : 'FAIL',
    missingDocs.length === 0 ? `${YC_REQUIRED_DOCS.length}/${YC_REQUIRED_DOCS.length} required docs present`
      : `missing: ${missingDocs.join(', ')}`);

  const proofRows = YC_PROOF_DOCS.map((proof) => {
    const present = deps.fileExists(proof.doc);
    const check = add(`proof:${proof.label}`, present ? 'PASS' : 'FAIL',
      present ? `recorded (${proof.phase} — ${proof.doc.split('/').pop()})` : `${proof.doc} missing`);
    return { proof, check };
  });

  /* --------------------------- frontend ------------------------------ */
  const frontendCheck = add('browser-frontend', 'MANUAL',
    'MANUAL VERIFICATION REQUIRED — the browser surface is not inspected by this check');

  /* ---------------------------- safety -------------------------------- */
  // Structural statements, enforced by the boundary + acceptance tests:
  // this module is import-free; the node deps may only run read-only git.
  add('no-live-provider', 'PASS', 'no live provider process started by this check');
  add('no-deployment', 'PASS', 'no deployment configured, no push performed');

  const failures = checks.filter((c) => c.status === 'FAIL');
  const exitCode = failures.length === 0 ? 0 : 1;

  /* ---------------------------- report -------------------------------- */
  const lines: string[] = [];
  lines.push('SUNDAY RELAY — YC DEMO PREFLIGHT');
  lines.push('(offline · read-only repo access · zero provider calls · zero network calls)');
  lines.push('');
  lines.push('REPOSITORY');
  lines.push(row('Identity', repoCheck.detail ?? 'unknown', repoCheck));
  lines.push(row('Checkout', branchCheck.detail ?? branchName, branchCheck));
  lines.push(row('Product baseline', baselineCheck.detail ?? 'unknown', baselineCheck));
  lines.push(row('Capability baseline', capabilityCheck.detail ?? 'unknown', capabilityCheck));
  lines.push(row('Working tree', treeCheck.detail ?? 'unknown', treeCheck));
  lines.push('');
  lines.push('RELAY CORE');
  for (const { proof, check } of proofRows) {
    lines.push(row(proof.label, check.detail ?? 'unknown', check));
  }
  lines.push('');
  lines.push('CLI DEMO');
  lines.push('  Mode: offline visual simulation');
  lines.push('  Fake adapters: yes');
  lines.push('  Provider calls: none');
  lines.push('  Real file changes: none');
  lines.push(row('Relay build', buildCheck.detail ?? '', buildCheck));
  lines.push(row('Demo scripts', scriptsCheck.detail ?? '', scriptsCheck));
  lines.push(row('Plain walkthrough', demoCheck.detail ?? '', demoCheck));
  lines.push('  Command: npm run relay:yc-demo:cli');
  lines.push('');
  lines.push('TERMINAL');
  lines.push(row('Width', widthCheck.detail ?? '', widthCheck));
  lines.push(row('Color', colorCheck.detail ?? '', colorCheck));
  lines.push('');
  lines.push('DOCUMENTATION');
  lines.push(row('Required docs', docsCheck.detail ?? '', docsCheck));
  lines.push('');
  lines.push('BROWSER FRONTEND');
  lines.push('  Status: MANUAL VERIFICATION REQUIRED');
  lines.push('  This check never inspects the browser surface: it opens no browser, serves no');
  lines.push('  page and reads no rendered route, so it can prove nothing about the frontend.');
  lines.push('  Verify it by hand and record the exact frontend command + URL before the video.');
  lines.push('');
  lines.push('DEMO TRUTHFULNESS');
  lines.push(`  Offline simulation labeled: ${demoOutput.includes('VISUAL SIMULATION') ? 'yes (verified in plain output)' : 'NOT VERIFIED'}`);
  lines.push('  Real workflow described separately: yes (Prompt 8.4 record)');
  lines.push('  No fake live-provider claim: yes (the timeline never claims live provider activity)');
  lines.push('');
  lines.push('SAFETY');
  lines.push('  Live provider processes started by this check: none (read-only git + in-process demo)');
  lines.push('  Writes: none to the repository or your state (offline demo uses an isolated, self-deleting temp dir)');
  lines.push('  Deployment configured by this command: none');
  lines.push('  Push performed: none');
  lines.push('');
  lines.push('RESULT');
  lines.push(exitCode === 0
    ? '  READY FOR FOUNDER ACCEPTANCE'
    : `  NOT READY — ${failures.length} blocking check(s): ${failures.map((f) => f.name).join(', ')}`);
  void frontendCheck;

  return { lines, checks, exitCode };
}
