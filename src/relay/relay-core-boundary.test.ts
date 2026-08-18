import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * A GENEROUS, EXPLICIT TIME BUDGET FOR THE WHOLE FILE — not a weakened rule.
 *
 * Every assertion here walks module roots from disk and reads each file. The
 * cost grows with the tree, and adding `src/relay/mcp` pushed several of these
 * walks past vitest's 5s default on a 2-core host: they failed for taking too
 * long, not for finding anything. Every rule below is unchanged and still fails
 * on the FIRST offending import; only the clock is different.
 */
vi.setConfig({ testTimeout: 120_000 });

/**
 * Relay Core boundary tests (TEST_STRATEGY §8, Prompt-2 scope): the NEW
 * module roots only — the prototype keeps its own existing boundary test
 * (relay-boundary.test.ts), which stays untouched. Dependency direction and
 * security invariants are asserted at the source level, matching the repo
 * convention.
 */

const root = process.cwd();
const relay = (p: string) => join(root, 'src', 'relay', p);

const CORE_ROOTS = [
  'protocol', 'core', 'ledger', 'storage', 'testing',
  'coordination', 'handoff', 'verification', 'recovery',
] as const;
const CLI_ROOT = 'cli';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = CORE_ROOTS.flatMap((r) => walk(relay(r)));
const read = (f: string) => readFileSync(f, 'utf8');

/* ------------------------------------------------------------------ *
 * Structural import resolution.
 *
 * A substring rule like /from ['"].*\/persistence/ cannot tell
 * `src/relay/persistence` — the NODE durable-state implementation, which no
 * browser module may reach — apart from `src/relay/ui/app/persistence.ts`,
 * the website's OWN localStorage adapter, which is exactly where browser
 * state belongs. The two lineages independently picked the word
 * "persistence", so the names collided when the repository was reunified.
 *
 * These helpers resolve a specifier to a real file and ask which MODULE ROOT
 * it lands in, so the rule asserts the architectural fact it actually means
 * and stays correct however a module is named.
 * ------------------------------------------------------------------ */

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx'];

/** Resolve a relative specifier to an absolute file, or null for bare
 * specifiers (npm packages, `node:` builtins) and unresolvable paths. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every relative import of a file, resolved to an absolute path — including
 * INLINE `import('…')`. The inline form carries no `from` clause, so a rule
 * that only matched `from '…'` would miss
 * `await import('../testing/factories')` entirely; this repository already
 * treats that form as "a boundary evasion" where it bans it in yc/ below.
 * `\s*` rather than `\s+` because `from'./x'` needs no space to compile.
 */
const IMPORT_SPECIFIER = /from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolvedImportsOf(file: string): Array<{ spec: string; target: string }> {
  const out: Array<{ spec: string; target: string }> = [];
  for (const m of read(file).matchAll(IMPORT_SPECIFIER)) {
    const spec = m[1] ?? m[2];
    const target = spec ? resolveImport(file, spec) : null;
    if (target) out.push({ spec, target });
  }
  return out;
}

/** Real containment, not a name match. */
const isInside = (target: string, dir: string): boolean =>
  target === dir || target.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** The Node durable-persistence implementation root. */
const NODE_PERSISTENCE_DIR = relay('persistence');

/** The deterministic TEST FIXTURE root. Production code may never reach it. */
const TEST_FIXTURE_DIR = relay('testing');

const FORBIDDEN_EVERYWHERE: Array<[RegExp, string]> = [
  [/from\s+['"]@\/fusion-engine|from\s+['"].*\/fusion-engine/, 'fusion-engine'],
  [/from\s+['"].*server\//, 'server implementation'],
  [/from\s+['"]@\/state\/|from\s+['"].*\/state\/session/, 'Sunday session store'],
  [/from\s+['"]@\/components\//, 'Sunday UI components'],
  [/from\s+['"]react['"]|from\s+['"]react-dom/, 'React'],
  [/from\s+['"]zustand/, 'zustand'],
  [/from\s+['"]@supabase|from\s+['"].*supabaseAuthClient/, 'Supabase implementation'],
  [/from\s+['"]openai['"]|from\s+['"]@anthropic/, 'provider SDKs'],
  [/process\.env\.(OPENAI|ANTHROPIC|SUPABASE)/, 'provider credential environment variables'],
];

describe('relay-core boundary (new module roots)', () => {
  it('finds the new roots and their sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no core module imports forbidden provider/server/UI/orchestration modules', () => {
    for (const file of files) {
      const content = read(file);
      for (const [pattern, why] of FORBIDDEN_EVERYWHERE) {
        expect(pattern.test(content), `${file} must not reference ${why}`).toBe(false);
      }
    }
  });

  it('relay-protocol depends on nothing above it (no core/ledger/storage/connectors imports)', () => {
    for (const file of walk(relay('protocol'))) {
      const content = read(file);
      expect(/from\s+['"]\.\.\/(core|ledger|storage|connectors|cli)/.test(content), `${file} imports upward`).toBe(false);
    }
  });

  it('coordination/handoff/verification/recovery contain no shell, Git, or filesystem execution', () => {
    for (const root of ['coordination', 'handoff', 'verification', 'recovery']) {
      for (const file of walk(relay(root)).filter((f) => !f.endsWith('.test.ts'))) {
        const content = read(file);
        expect(/child_process|execSync|spawn\(|simple-git|isomorphic-git/.test(content), `${file} executes processes`).toBe(false);
        expect(/from\s+['"]node:/.test(content), `${file} uses node builtins`).toBe(false);
        expect(/readFileSync|writeFileSync|\bfs\./.test(content), `${file} touches the filesystem`).toBe(false);
      }
    }
  });

  it('no core production module imports the deterministic test fixtures', () => {
    // `src/relay/testing` is reachable from main.tsx and therefore ships in the
    // browser bundle. A production import of it drags the whole fixture surface
    // in and makes factories.ts's own "tests and production never mix" claim
    // false. Resolution is structural (real containment), so the rule survives
    // a rename of the fixture module. Test files are exempt — that is what the
    // fixtures are for — and fixtures importing their own root are skipped.
    const offenders: string[] = [];
    for (const file of files.filter((f) => !f.endsWith('.test.ts'))) {
      if (isInside(file, TEST_FIXTURE_DIR)) continue;
      for (const { spec, target } of resolvedImportsOf(file)) {
        if (isInside(target, TEST_FIXTURE_DIR)) offenders.push(`${file} imports ${spec}`);
      }
    }
    expect(offenders, 'production code must never import the test fixture module').toEqual([]);
  });

  it('CLI is a thin client: only the app facade, read-model types, protocol, workspace facade, and its own modules', () => {
    // '../workspace' (the composition-root facade) is the ONLY workspace
    // import the CLI may use — internals are asserted below.
    // `../shared` is the BROWSER-SAFE SEAM: pure projections both surfaces
    // render. The CLI consuming it is the point — it is what stops the website
    // from importing a CLI renderer to get the same bundle. It carries no
    // provider, no persistence and no Node built-in (asserted by
    // shared/browser-boundary.test.ts), so it does not widen the thin client.
    // `agent-operating` is the CLI's renderer for the SHARED operating-profile
    // projection, and sits beside `mission-economics` for the same reason: the
    // domain lives in `../mission`, and only the presentation is local.
    const ALLOWED = /from\s+['"](\.\/(main|interactive|render|exit-codes|index|presentation|competitive|mission-control|mission-economics|coliseum-cli|agent-operating|claude-runtime|product|reviewer-bridge-cli|mcp-cli|loop-cli|loop-execution|loop-run-cli)|\.\.\/core\/app|\.\.\/protocol\/(version|ids|errors)|\.\.\/testing\/factories|\.\.\/workspace|\.\.\/connectors\/(claude-code|codex-reviewer|gpt-architect|supervised)|\.\.\/mission|\.\.\/mcp|\.\.\/shared(\/[a-z-]+)?|\.\.\/reviewer-bridge-client|\.\.\/loop-bridge-client|\.\.\/persistence|\.\.\/yc|\.\.\/psp(\/psp-fixtures)?|node:util|node:readline)['"]/;
    // The Prompt-8.6 product shell is CLI-internal: its files may import ONLY
    // each other, the persistence facade (canonical durable state), and the
    // node builtins needed for the isolated demo state root — never `../main`
    // (which carries the provider adapters), `../render` (Relay Core), adapters,
    // Relay Core internals, or child_process. Keeping the allowlist this narrow
    // is what enforces the spec's "zero provider-adapter imports under product/".
    // `../../psp` is the SHARED PSP Agent ID domain — the same byte-identical
    // modules the website carries. It is pure, browser-safe and provider-free,
    // so the product shell may consume it directly rather than growing a
    // second, divergent implementation of the same entitlement rules.
    // `../../shared/<module>` is the BROWSER-SAFE SEAM, and it is allowed for
    // exactly the same reason: the official Relay Dog sprite, states and
    // parity manifest live there as ONE copy that both surfaces import, which
    // is what makes a second mascot unrepresentable rather than merely
    // checksummed. Only flat single-segment modules are reachable, so the
    // product shell cannot walk into a nested CLI-shaped subtree there.
    const PRODUCT_ALLOWED = /from\s+['"](\.\/[a-z-]+|\.\.\/\.\.\/(persistence|psp|shared\/[a-z-]+)|node:(fs|os|path|util))['"]/;
    const isProductFile = (f: string): boolean => f.includes(join('cli', 'product'));
    for (const file of walk(relay(CLI_ROOT)).filter((f) => !f.endsWith('.test.ts'))) {
      const content = read(file);
      const imports = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        const allowed = isProductFile(file) ? PRODUCT_ALLOWED : ALLOWED;
        expect(allowed.test(`from '${imp}'`), `${file} imports ${imp} — CLI must stay a thin client`).toBe(true);
      }
      // No workflow internals ever:
      expect(/from\s+['"]\.\.\/(ledger|coordination|handoff|verification|recovery)\//.test(content), `${file} imports workflow internals`).toBe(false);
      expect(/from\s+['"]\.\.\/core\/(run-machine|task-machine|orchestrator|read-models)/.test(content), `${file} imports core internals directly`).toBe(false);
      expect(/from\s+['"]\.\.\/storage\//.test(content), `${file} imports storage directly`).toBe(false);
      // Simulation adapters are off-limits; the Claude adapter facade is the
      // one approved connector composition root.
      expect(/from\s+['"]\.\.\/connectors\/(simulated|ports|index)/.test(content), `${file} imports simulation adapters directly`).toBe(false);
      // Workspace: facade only — never the Node internals, never child_process.
      expect(/from\s+['"]\.\.\/workspace\/(worktree-manager|command-runner|repository-inspector|cleanup|command-policy|protected-paths|output-sanitizer|workspace-evidence|verify-harness|doctor)/.test(content), `${file} imports workspace internals — CLI may only use the facade`).toBe(false);
      expect(/child_process/.test(content), `${file} spawns processes — only the workspace module may`).toBe(false);
    }
    // And core/protocol never import the CLI back:
    for (const file of files) {
      expect(/from\s+['"].*\/cli\//.test(read(file)), `${file} imports the CLI`).toBe(false);
    }
  });

  it('recovery contains no provider-reassignment implementation', () => {
    for (const file of walk(relay('recovery')).filter((f) => !f.endsWith('.test.ts'))) {
      const content = read(file);
      expect(/reassignToProvider|switchProvider|dispatchToOtherAgent/.test(content), `${file} implements reassignment`).toBe(false);
    }
  });

  it('relay-core and relay-ledger depend only on protocol + storage INTERFACES (never the in-memory adapter)', () => {
    // core/app.ts is the ONE approved composition root (Prompt 5): it may
    // compose the volatile stores for the simulation profile.
    const productionFiles = [...walk(relay('core')), ...walk(relay('ledger'))].filter(
      (f) => !f.endsWith('.test.ts') && !f.endsWith('core/app.ts'),
    );
    for (const file of productionFiles) {
      const content = read(file);
      expect(/from\s+['"]\.\.\/storage\/memory/.test(content), `${file} imports the volatile adapter`).toBe(false);
      expect(/from\s+['"]node:/.test(content), `${file} uses node builtins in pure logic`).toBe(false);
    }
  });

  it('browser APIs stay out of core logic (headless requirement)', () => {
    for (const file of files.filter((f) => !f.endsWith('.test.ts'))) {
      const content = read(file);
      expect(/\b(document|window|localStorage|navigator)\./.test(content), `${file} touches browser APIs`).toBe(false);
    }
  });

  it('the in-memory adapter cannot masquerade as durable production storage', () => {
    const memory = read(relay('storage/memory.ts'));
    expect(memory).toContain("durability: 'volatile-test-only'");
    expect(memory).toContain('acknowledgeVolatile');
  });
});

describe('Workspace boundaries (Prompt 7)', () => {
  const workspaceDir = relay('workspace');
  const workspaceFiles = walk(workspaceDir).filter((f) => !f.endsWith('.test.ts'));
  const PURE_WORKSPACE_MODULES = ['contracts.ts', 'protected-paths.ts', 'command-policy.ts', 'output-sanitizer.ts', 'cleanup.ts'];

  it('browser-safe workspace modules (contracts + policies) never touch Node APIs', () => {
    for (const name of PURE_WORKSPACE_MODULES) {
      const content = read(join(workspaceDir, name));
      expect(/from\s+['"]node:/.test(content), `${name} imports node builtins`).toBe(false);
      expect(/child_process/.test(content), `${name} references child_process`).toBe(false);
    }
  });

  // The approved LIVE local adapters (Claude coding agent + Codex reviewer)
  // and the Prompt-8.4 supervised composition over them may use the workspace
  // facade and spawn processes; simulation adapters may not.
  const isClaudeAdapter = (f: string): boolean =>
    f.includes(join('connectors', 'claude-code')) || f.includes(join('connectors', 'codex-reviewer')) ||
    f.includes(join('connectors', 'supervised'));

  it('Relay Core, protocol, ledger never import the workspace implementation or child_process', () => {
    for (const file of files) {
      const content = read(file);
      expect(/from\s+['"].*\/workspace\//.test(content), `${file} imports workspace internals`).toBe(false);
      expect(/child_process/.test(content), `${file} references child_process`).toBe(false);
    }
    // Simulation adapters (connectors except the approved Claude adapter)
    // never touch workspaces or spawn processes.
    for (const file of walk(relay('connectors')).filter((f) => !f.endsWith('.test.ts') && !isClaudeAdapter(f))) {
      const content = read(file);
      expect(/from\s+['"].*\/workspace/.test(content), `${file} — simulation adapters cannot access workspaces`).toBe(false);
      expect(/child_process|createWorktree|createWorkspaceService/.test(content), `${file} — simulation adapters cannot spawn or manage worktrees`).toBe(false);
    }
  });

  it('only the workspace module and the approved live adapters spawn processes inside src/relay', () => {
    // The YC preflight node-deps file (Prompt 8.7) is the one additional
    // approved process spawner — READ-ONLY git only, asserted separately.
    // Exempt it by FULL PATH so no other <dir>/node-deps.ts could escape.
    const ycNodeDeps = relay(join('yc', 'node-deps.ts'));
    const allRelayFiles = [
      ...files,
      ...walk(relay('cli')),
      ...walk(relay('connectors')).filter((f) => !isClaudeAdapter(f)),
      ...walk(relay('domain')),
      ...walk(relay('state')),
      ...walk(relay('yc')).filter((f) => f !== ycNodeDeps),
    ].filter((f) => !f.endsWith('.test.ts'));
    for (const file of allRelayFiles) {
      expect(/child_process/.test(read(file)), `${file} uses child_process outside the workspace / Claude adapter boundary`).toBe(false);
    }
    // and the workspace implementation actually enforces shell: false
    const runner = read(join(workspaceDir, 'command-runner.ts'));
    expect(runner).toContain('shell: false');
    expect(runner).not.toMatch(/shell:\s*true/);
  });

  it('workspace git surface bans push/reset/clean/force and the runner policy denies them independently', () => {
    for (const file of workspaceFiles) {
      const content = read(file);
      expect(/\bpush\b.*--force|force-push/i.test(content), `${file} references force pushes`).toBe(false);
    }
    const inspector = read(join(workspaceDir, 'repository-inspector.ts'));
    for (const banned of ["'push'", "'reset'", "'clean'", "'merge'", "'--force'"]) {
      expect(inspector.includes(banned), `repository-inspector must not invoke git ${banned}`).toBe(false);
    }
    const policy = read(join(workspaceDir, 'command-policy.ts'));
    expect(policy).toContain("'push'");
    expect(policy).toContain("'reset'");
    expect(policy).toContain("'clean'");
  });

  it('workspace evidence is live-local and the browser prototype cannot import workspace code', () => {
    const evidence = read(join(workspaceDir, 'workspace-evidence.ts'));
    expect(evidence).toContain("provenance: 'live'");
    for (const name of ['main.tsx', 'RelayApp.tsx', 'StagePanel.tsx', 'PipelineRail.tsx']) {
      const content = read(relay(name));
      expect(/from\s+['"].*\/workspace/.test(content), `${name} imports workspace code`).toBe(false);
    }
  });
});

describe('Mission Control boundaries (Prompt 8.2)', () => {
  const missionDir = relay('mission');
  const uiDir = relay('ui');
  const uiFiles = walk(uiDir).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));

  it('the mode / dog / entitlement / terminal / credential engines are pure (no Node)', () => {
    for (const name of ['modes.ts', 'dog.ts', 'entitlement.ts', 'terminal.ts', 'credential-handle.ts']) {
      const content = read(join(missionDir, name));
      expect(/from\s+['"]node:/.test(content), `${name} imports node builtins`).toBe(false);
      expect(/child_process/.test(content), `${name} references child_process`).toBe(false);
    }
  });

  it('credential handles never hold secret values (no raw password/token fields)', () => {
    const ch = read(join(missionDir, 'credential-handle.ts'));
    // The value field never exists; only names/scopes/policy are stored.
    expect(/credentialValue|passwordValue|rawToken|secretValue\s*:/.test(ch)).toBe(false);
    expect(ch.toLowerCase()).toContain('never contains the credential value');
  });

  it('the graphical UI projects from Relay Core / mission — never Node, adapters, or workspace', () => {
    for (const file of uiFiles) {
      const content = read(file);
      expect(/from\s+['"]node:/.test(content), `${file} imports node builtins`).toBe(false);
      expect(/child_process/.test(content), `${file} references child_process`).toBe(false);
      expect(/from\s+['"].*\/(workspace|connectors\/claude-code)/.test(content), `${file} imports Node-only adapters/workspace`).toBe(false);
    }
  });

  it('adapters cannot control dog speed, mode, entitlement, or release', () => {
    for (const file of walk(relay('connectors')).filter((f) => !f.endsWith('.test.ts'))) {
      const content = read(file);
      expect(/computeDogActivity|selectMode|computeOutputVisibility|entitlementPolicy|buildAutonomousConsent/.test(content), `${file} controls mission-control policy`).toBe(false);
    }
  });
});

describe('Codex Reviewer boundaries (Prompt 8.3)', () => {
  const codexDir = relay(join('connectors', 'codex-reviewer'));
  const codexFiles = walk(codexDir).filter((f) => !f.endsWith('.test.ts'));
  const missionDir = relay('mission');
  const uiDir = relay('ui');

  it('Relay Core, protocol, and ledger never import the Codex reviewer adapter', () => {
    for (const file of files) {
      const content = read(file);
      expect(/from\s+['"].*connectors\/codex-reviewer/.test(content), `${file} imports the Codex adapter`).toBe(false);
    }
  });

  it('browser-safe mission + UI code never imports the Codex reviewer (Node) adapter', () => {
    for (const file of [...walk(missionDir), ...walk(uiDir)].filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))) {
      const content = read(file);
      expect(/from\s+['"].*connectors\/codex-reviewer/.test(content), `${file} imports the Codex adapter`).toBe(false);
    }
  });

  it('never uses a sandbox-bypass, hook-bypass, full-access, or workspace-write flag', () => {
    for (const file of codexFiles) {
      // The permission compiler DECLARES the bypass flags in a FORBIDDEN_FLAGS
      // denylist (to assert they are never emitted); scrub that declaration
      // before checking that no code actually references a bypass flag.
      const content = read(file).replace(/FORBIDDEN_FLAGS[\s\S]*?\] as const;/, '');
      expect(/dangerously-bypass-approvals-and-sandbox|dangerously-bypass-hook-trust/.test(content), `${file} contains a bypass flag`).toBe(false);
    }
    // The permission compiler only ever selects the read-only sandbox and
    // never enables workspace-write / danger-full-access / --add-dir / network
    // (the FORBIDDEN_FLAGS denylist is scrubbed before checking usage).
    const perms = read(join(codexDir, 'permission-compiler.ts')).replace(/FORBIDDEN_FLAGS[\s\S]*?\] as const;/, '');
    expect(perms).toContain("'--sandbox', 'read-only'");
    expect(perms).not.toMatch(/'--sandbox',\s*'workspace-write'|'--sandbox',\s*'danger-full-access'/);
    expect(perms).not.toContain("'--add-dir'");
  });

  it('the read-only reviewer never approves release, marks itself independent, or decides the gate', () => {
    for (const file of codexFiles) {
      const content = read(file);
      // Release / independence / finding decisions are Relay-owned: the
      // connector may only call the single composite evaluateReviewerGate
      // (never the primitives), and never the mode/dog/consent engines.
      expect(/computeOutputVisibility|computeDogActivity|selectMode|buildAutonomousConsent|assignReviewer/.test(content), `${file} decides Relay policy itself`).toBe(false);
    }
    // The adapter descriptor cannot declare itself independent.
    const adapter = read(join(codexDir, 'adapter.ts'));
    expect(/marksIndependent|selfIndependent|independent:\s*true/.test(adapter)).toBe(false);
  });

  it('the environment filter strips explicit provider keys before the child runs', () => {
    const env = read(join(codexDir, 'environment.ts'));
    for (const name of ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'OPENAI_BASE_URL']) {
      expect(env.includes(name), `environment.ts must strip ${name}`).toBe(true);
    }
  });

  it('capability / process / stream / report modules make no network claim and use shell:false', () => {
    const runner = read(join(codexDir, 'process-runner.ts'));
    expect(runner).toContain('shell: false');
    expect(runner).not.toMatch(/shell:\s*true/);
  });
});

describe('Supervised workflow boundaries (Prompt 8.4)', () => {
  const supervisedDir = relay(join('connectors', 'supervised'));
  const supervisedFiles = walk(supervisedDir).filter((f) => !f.endsWith('.test.ts'));
  const supervisedProduction = supervisedFiles.filter((f) => !f.endsWith('verify-harness.ts'));

  it('Relay Core, protocol, ledger, mission, and UI never import the supervised composition', () => {
    for (const file of [...files, ...walk(relay('mission')), ...walk(relay('ui'))].filter(
      (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
    )) {
      expect(/from\s+['"].*connectors\/supervised/.test(read(file)), `${file} imports the supervised composition`).toBe(false);
    }
    for (const name of ['main.tsx', 'RelayApp.tsx', 'StagePanel.tsx', 'PipelineRail.tsx']) {
      expect(/from\s+['"].*connectors\/supervised/.test(read(relay(name))), `${name} imports the supervised composition`).toBe(false);
    }
  });

  it('the supervised runner composes the approved adapters — it never spawns processes itself', () => {
    for (const file of supervisedFiles) {
      expect(/child_process|spawnSync|execFileSync/.test(read(file)), `${file} spawns processes directly`).toBe(false);
    }
  });

  it('NO fault injection: the runner never seeds defects or writes implementation content', () => {
    for (const file of supervisedProduction) {
      const content = read(file);
      expect(content.includes('DEFECT_IMPLEMENTATION'), `${file} references a seeded defect`).toBe(false);
      expect(/writeFileSync|appendFileSync/.test(content), `${file} writes files into the workspace`).toBe(false);
      expect(content.includes('demo.fault_injected'), `${file} emits a fault-injection event`).toBe(false);
    }
  });

  it('no demo.fault_injected event exists anywhere in Relay production sources', () => {
    // Verify-harnesses may MENTION the event name only to assert its absence.
    const productionFiles = [
      ...files, ...walk(relay('connectors')), ...walk(relay('cli')),
      ...walk(relay('mission')), ...walk(relay('workspace')),
    ].filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx') && !f.endsWith('verify-harness.ts'));
    for (const file of productionFiles) {
      expect(read(file).includes('demo.fault_injected'), `${file} contains a fault-injection event`).toBe(false);
    }
  });

  it('verdicts come only from the parsed reviewer report and the Relay-owned gate', () => {
    const runner = read(join(supervisedDir, 'live-runner.ts'));
    expect(runner).toContain('report.verdict');
    expect(runner).toContain('evaluateReviewerGate');
    expect(runner).toContain('evaluateCompletionPolicy');
    // The runner never decides release visibility itself (line-244 invariant
    // also covers this for every connector file).
    expect(runner.includes('computeOutputVisibility')).toBe(false);
  });
});

describe('Durable persistence boundaries (Prompt 8.5)', () => {
  const persistenceDir = relay('persistence');
  const persistenceFiles = walk(persistenceDir).filter((f) => !f.endsWith('.test.ts'));
  // Files that legitimately spawn processes: the READ-ONLY recovery git
  // inspector and the offline restart-proof entries (harness/driver/drill).
  const PROCESS_FILES = ['recovery-inspector.ts', 'verify-harness.ts', 'driver-main.ts', 'recovery-drill.ts'];
  // Files that may reference connectors: the supervised bridge (types) and
  // the offline restart-proof entries that drive fake supervised runs.
  const CONNECTOR_FILES = ['supervised-recorder.ts', 'verify-harness.ts', 'driver-main.ts', 'recovery-drill.ts'];
  const base = (f: string): string => f.split(/[\\/]/).pop() ?? f;

  it('Relay Core, protocol, ledger, mission, UI and the shared seam never import the Node persistence implementation', () => {
    // Structural, not textual: an import is a violation when it RESOLVES into
    // src/relay/persistence. `src/relay/ui/app/persistence.ts` — the website's
    // own localStorage adapter — is a different module and is allowed.
    const offenders: string[] = [];
    for (const file of [
      ...files,
      ...walk(relay('mission')),
      ...walk(relay('ui')),
      ...walk(relay('shared')),
    ].filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))) {
      for (const { spec, target } of resolvedImportsOf(file)) {
        if (isInside(target, NODE_PERSISTENCE_DIR)) offenders.push(`${file} imports ${spec}`);
      }
    }
    expect(offenders, 'these modules must never reach the Node persistence layer').toEqual([]);
  });

  it('the website keeps its own browser storage adapter, and it is NOT the Node layer', () => {
    // The repaired rule must still permit the legitimate browser module — a
    // guard against "fixing" the collision by deleting the website's storage.
    const browserStore = join(relay('ui'), 'app', 'persistence.ts');
    expect(existsSync(browserStore), 'the website browser storage adapter must exist').toBe(true);
    expect(isInside(browserStore, NODE_PERSISTENCE_DIR)).toBe(false);
    const src = read(browserStore);
    expect(src).toContain('localStorage');
    expect(/from\s+['"]node:/.test(src), 'the browser storage adapter must not use node: builtins').toBe(false);

    const consumer = join(relay('ui'), 'app', 'store.ts');
    const specs = resolvedImportsOf(consumer).map((i) => i.target);
    expect(specs).toContain(browserStore);
    expect(specs.some((t) => isInside(t, NODE_PERSISTENCE_DIR))).toBe(false);
  });

  it('no browser module reaches the Node persistence layer through a re-export chain', () => {
    // A one-hop rule is defeated by a barrel that re-exports the Node layer.
    // Walk transitively from the UI roots and assert the closure is clean.
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = walk(relay('ui')).filter((f) => !/\.test\.tsx?$/.test(f));
    queue.push(...walk(relay('shared')).filter((f) => !/\.test\.tsx?$/.test(f)));
    queue.forEach((f) => seen.add(f));
    while (queue.length) {
      const file = queue.shift()!;
      for (const { spec, target } of resolvedImportsOf(file)) {
        if (isInside(target, NODE_PERSISTENCE_DIR)) { offenders.push(`${file} → ${spec}`); continue; }
        if (isInside(target, relay('cli'))) { offenders.push(`${file} → ${spec} (CLI surface)`); continue; }
        if (seen.has(target) || /\.test\.tsx?$/.test(target)) continue;
        seen.add(target);
        queue.push(target);
      }
    }
    expect(offenders, 'transitive browser closure must contain no CLI or Node persistence module').toEqual([]);
  });

  it('connectors never import persistence — the supervised runner sees only its own hooks interface', () => {
    for (const file of walk(relay('connectors')).filter((f) => !f.endsWith('.test.ts'))) {
      expect(/from\s+['"].*\/persistence/.test(read(file)), `${file} imports persistence`).toBe(false);
    }
  });

  it('only the recovery inspector and offline restart-proof entries spawn processes', () => {
    for (const file of persistenceFiles) {
      if (PROCESS_FILES.includes(base(file))) continue;
      expect(/child_process|execFileSync|spawnSync|spawn\(/.test(read(file)), `${file} spawns processes`).toBe(false);
    }
    // The recovery git surface is inspection-only.
    const inspector = read(join(persistenceDir, 'recovery-inspector.ts'));
    expect(inspector).toContain("'rev-parse'");
    expect(inspector).toContain("'status'");
    for (const banned of ["'push'", "'reset'", "'clean'", "'checkout'", "'commit'", "'merge'"]) {
      expect(inspector.includes(banned), `recovery-inspector must not invoke git ${banned}`).toBe(false);
    }
  });

  it('the recovery service can never launch a provider', () => {
    const recovery = read(join(persistenceDir, 'recovery.ts'));
    expect(/connectors\/(claude-code|codex-reviewer)|invokeReview|\.invoke\(|createClaudeCodeAdapter|createCodexReviewerAdapter/.test(recovery))
      .toBe(false);
    expect(recovery).toContain('requiresFounderAuthorizationForLiveCalls: true');
  });

  it('persistence production files stay out of the connectors except the approved bridge/proof entries', () => {
    for (const file of persistenceFiles) {
      if (CONNECTOR_FILES.includes(base(file))) continue;
      expect(/from\s+['"].*\/connectors\//.test(read(file)), `${file} imports connectors`).toBe(false);
    }
  });

  it('journal writes are always sanitized and the redaction denylist exists', () => {
    const journal = read(join(persistenceDir, 'journal.ts'));
    expect(journal).toContain('sanitizePayload');
    const redaction = read(join(persistenceDir, 'redaction.ts'));
    for (const marker of ['password', 'api[-_]?key', 'access[-_]?token', 'refresh[-_]?token', 'cookie', 'recovery[-_]?code']) {
      expect(redaction.includes(marker), `redaction denylist must cover ${marker}`).toBe(true);
    }
    expect(redaction).toContain('chain[- ]of[- ]thought');
  });

  it('the state root never lives inside a Git repository and files use restrictive modes', () => {
    const paths = read(join(persistenceDir, 'paths.ts'));
    expect(paths).toContain("'.git'");
    expect(paths).toContain('0o700');
    const atomic = read(join(persistenceDir, 'atomic-file.ts'));
    expect(atomic).toContain('0o600');
    expect(atomic).toContain('renameSync');
  });
});

describe('YC demo acceptance boundaries (Prompt 8.7)', () => {
  const ycDir = relay('yc');
  const NODE_DEPS = join(ycDir, 'node-deps.ts');
  const ycFiles = walk(ycDir).filter((f) => !f.endsWith('.test.ts'));

  it('the yc directory contains EXACTLY the known files (no nested dirs, no .js helpers)', () => {
    // The strongest guard: a full inventory means a nested `yc/sub/node-deps.ts`,
    // a `.js`/`.mjs` helper (invisible to the .ts-only walk), or any unknown
    // file cannot slip past the assertions below.
    const names = readdirSync(ycDir).sort();
    expect(names).toEqual(['index.ts', 'node-deps.ts', 'preflight.ts', 'yc-acceptance.test.ts']);
  });

  it('yc is a LEAF module: no imports from the rest of Relay, and no dynamic import/require', () => {
    for (const file of ycFiles) {
      const content = read(file);
      expect(/from\s+['"]\.\.\//.test(content), `${file} imports outside src/relay/yc`).toBe(false);
      // Dynamic import()/require() would carry no `from` clause and evade the
      // static allowlist — ban them outright (no yc file needs them).
      expect(/\bimport\s*\(|\brequire\s*\(/.test(content), `${file} uses dynamic import()/require() — a boundary evasion`).toBe(false);
      const YC_ALLOWED = /from\s+['"](\.\/[a-z-]+|node:(child_process|fs|path))['"]/;
      for (const imp of [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])) {
        expect(YC_ALLOWED.test(`from '${imp}'`), `${file} imports ${imp} — yc allows only siblings + node child_process/fs/path`).toBe(true);
      }
    }
  });

  it('the preflight engine is PURE (no imports at all) and only node-deps.ts may spawn', () => {
    const preflight = read(join(ycDir, 'preflight.ts'));
    expect(/from\s+['"]/.test(preflight), 'preflight.ts must stay import-free').toBe(false);
    for (const file of ycFiles) {
      if (file === NODE_DEPS) continue; // exempt by FULL PATH, not filename suffix
      expect(/child_process|execFileSync|spawnSync|spawn\(/.test(read(file)), `${file} spawns processes`).toBe(false);
    }
  });

  it('the node deps run READ-ONLY git only — pinned allowlist, sanitized env, no mutation, no network, no writes', () => {
    const deps = read(NODE_DEPS);
    // Pin the subcommand allowlist EXACTLY so a network-capable subcommand
    // (fetch/pull/worktree) can never pass silently.
    expect(deps).toContain("new Set(['rev-parse', 'status', 'merge-base'])");
    for (const banned of ["'push'", "'reset'", "'clean'", "'checkout'", "'commit'", "'merge'", "'stash'",
      "'restore'", "'fetch'", "'pull'", "'worktree'", "'ls-remote'", "'submodule'", "'config'"]) {
      expect(deps.includes(banned), `node-deps must not invoke git ${banned}`).toBe(false);
    }

    // `remote` is the one subcommand allowed OUTSIDE that set, because the
    // post-separation readiness check identifies the repository by its origin
    // URL rather than by a branch name. It is also the one subcommand here
    // whose other forms MUTATE (`remote add|set-url|rename|remove`), so it is
    // NOT allowed by name: the full argument vector is matched element by
    // element, with a fixed length, against a literal allowlist. That is a
    // stricter contract than the old blanket ban on the word — it pins the
    // exact three arguments that may ever be passed.
    expect(deps).toContain("const EXACT_READONLY_GIT_FORMS");
    expect(deps).toContain("['remote', 'get-url', 'origin']");
    expect(deps).toContain('form.length === args.length');
    expect(deps).toContain('form.every((part, i) => part === args[i])');
    // The mutating forms must appear nowhere.
    for (const mutation of ["'set-url'", "'add'", "'rename'", "'remove'", "'prune'", "'update'"]) {
      expect(deps.includes(`'remote', ${mutation}`), `node-deps must not invoke git remote ${mutation}`).toBe(false);
    }
    // The exact-form allowlist must be the ONLY way past the subcommand gate:
    // declared once, called once, inside the single guard.
    expect(deps).toContain('const isExactReadonlyForm =');
    expect(deps.match(/isExactReadonlyForm\(/g)?.length, 'exactly one call site').toBe(1);
    expect(deps).toContain('READONLY_GIT_SUBCOMMANDS.has(args[0]) || isExactReadonlyForm(args)');
    // The git child must get an explicit SANITIZED env — never raw process.env
    // (which would leak provider keys and let GIT_DIR/GIT_WORK_TREE redirect
    // the "current repository" checks at another tree).
    expect(deps).toContain('env: gitEnv(');
    expect(deps).toContain('GIT_TERMINAL_PROMPT');
    expect(/process\.env/.test(deps), 'node-deps must not inherit raw process.env into git').toBe(false);
    for (const file of ycFiles) {
      const content = read(file);
      expect(/node:https?|node:net|node:tls|node:dgram|fetch\(|WebSocket|XMLHttpRequest/.test(content), `${file} reaches the network`).toBe(false);
      // Ban BOTH sync and async fs writes — node:fs is allowed for reads only.
      expect(/writeFileSync|appendFileSync|mkdirSync|rmSync|renameSync|unlinkSync|writeSync/.test(content), `${file} writes to disk (sync)`).toBe(false);
      expect(/writeFile\(|appendFile\(|mkdir\(|rmdir\(|\brm\(|rename\(|unlink\(|createWriteStream|fs\/promises|\.promises\b/.test(content), `${file} writes to disk (async)`).toBe(false);
    }
  });

  it('yc never references another checkout on the machine, providers, or deployment', () => {
    for (const file of ycFiles) {
      const content = read(file);
      // These names are OTHER CHECKOUTS, not a frontend repository: Relay's
      // browser surface is in this tree. The rule is that the yc leaf may
      // never name a path outside this checkout.
      expect(/claude-home|sunday-relay-claude|codex-home|codex-landing/.test(content), `${file} references another checkout on the machine`).toBe(false);
      expect(/connectors\/(claude-code|codex-reviewer|supervised)|createClaudeCodeAdapter|createCodexReviewerAdapter|--confirm-live/.test(content), `${file} can reach a provider adapter`).toBe(false);
      // The preflight REPORTS "no deployment" truthfully — so ban the
      // tooling, not the word: no deploy command can be invoked from yc.
      expect(/vercel|netlify|docker push|npm publish|gh release|firebase deploy/i.test(content), `${file} references deployment tooling`).toBe(false);
    }
  });

  it('nothing but cli/main.ts imports yc — core, protocol, ledger, mission, product, connectors, domain, state, ui', () => {
    // main.ts is the ONE allowed importer (via the updated cli ALLOWED
    // regex); every other root — including the prototype domain/state/ui —
    // must stay clear so the yc leaf can never be pulled into another layer.
    const consumers = [
      ...files, ...walk(relay('mission')), ...walk(relay('connectors')),
      ...walk(relay('workspace')), ...walk(relay('persistence')),
      ...walk(relay(join('cli', 'product'))),
      ...walk(relay('domain')), ...walk(relay('state')), ...walk(relay('ui')),
    ].filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
    for (const file of consumers) {
      expect(/from\s+['"].*\/yc['"]|from\s+['"].*\/yc\//.test(read(file)), `${file} imports the yc module`).toBe(false);
    }
  });
});

describe('Mission projection boundaries (Prompt 8.1)', () => {
  const missionDir = relay('mission');
  const missionFiles = walk(missionDir).filter((f) => !f.endsWith('.test.ts'));

  it('the mission layer is a PURE projection — no Node, no child_process, no fs', () => {
    for (const file of missionFiles) {
      const content = read(file);
      expect(/from\s+['"]node:/.test(content), `${file} imports node builtins`).toBe(false);
      expect(/child_process|readFileSync|writeFileSync|spawn\(/.test(content), `${file} touches Node process/fs`).toBe(false);
    }
  });

  it('the mission layer does not import Relay Core internals, adapters, or the CLI', () => {
    for (const file of missionFiles) {
      const content = read(file);
      expect(/from\s+['"]\.\.\/(core|connectors|cli|workspace|ledger|coordination|handoff|recovery|storage)\//.test(content), `${file} imports Relay internals — mission must stay a leaf projection`).toBe(false);
      expect(/fusion-engine|from\s+['"]react|@supabase/.test(content), `${file} imports app/UI/backend`).toBe(false);
    }
  });

  it('Relay Core, protocol, and ledger never import the mission projection', () => {
    for (const file of files) {
      expect(/from\s+['"].*\/mission/.test(read(file)), `${file} imports the mission projection`).toBe(false);
    }
  });

  it('adapters cannot resolve findings, promote evidence, or decide mission completion', () => {
    // The live Codex reviewer and the Prompt-8.4 supervised composition MAY
    // import the permitted mission surfaces (execution-attestation builder,
    // the reviewer-gate composite, review/repair + entitlement contracts).
    // Every other adapter stays out of the mission projection, and NO adapter
    // may call the mission-completion deciders (verdict engine, finding
    // resolution, mission-contract builder).
    const isCodexReviewer = (f: string): boolean =>
      f.includes(join('connectors', 'codex-reviewer')) || f.includes(join('connectors', 'supervised'));
    for (const file of [...walk(relay('connectors')).filter((f) => !f.endsWith('.test.ts'))]) {
      const content = read(file);
      if (!isCodexReviewer(file)) {
        expect(/from\s+['"].*\/mission/.test(content), `${file} — adapters cannot own mission verdicts`).toBe(false);
      }
      expect(/evaluateMissionVerdict|resolveFinding|buildMissionContract|projectReviewLedger/.test(content), `${file} decides mission completion`).toBe(false);
    }
  });

  it('the mission layer stays secret-free and separates requested from actual identity', () => {
    const attestation = read(join(missionDir, 'attestation.ts'));
    expect(attestation).toContain('requestedAgentId');
    expect(attestation).toContain('actualAgentId');
    expect(attestation).toContain('fallback');
    const CREDENTIAL_FIELD = /\b(apiKey|accessToken|refreshToken|clientSecret|privateKey|password|bearer)\b\s*[:?]/;
    for (const file of missionFiles) {
      expect(CREDENTIAL_FIELD.test(read(file)), `${file} declares a credential-shaped field`).toBe(false);
    }
  });
});

describe('Claude Code adapter boundaries (Prompt 8)', () => {
  const claudeDir = relay(join('connectors', 'claude-code'));
  const claudeFiles = walk(claudeDir).filter((f) => !f.endsWith('.test.ts'));

  it('Relay Core never imports the Claude adapter; the adapter only implements the port', () => {
    for (const file of files) {
      expect(/from\s+['"].*connectors\/claude-code/.test(read(file)), `${file} imports the Claude adapter`).toBe(false);
    }
    // The adapter conforms to the CodingAgentAdapter port (structural).
    const adapter = read(join(claudeDir, 'adapter.ts'));
    expect(adapter).toContain('CodingAgentAdapterPort');
    expect(adapter).toContain("provenance: 'live'");
  });

  it('the Claude adapter cannot mutate FileClaims, promote claims, or create source worktrees', () => {
    for (const file of claudeFiles) {
      const content = read(file);
      expect(/acquireFileClaim|promoteClaim|recordClaim/.test(content), `${file} touches claims/promotion`).toBe(false);
      expect(/createWorktree|removeWorktree|worktree-manager/.test(content), `${file} creates worktrees directly`).toBe(false);
      expect(/from\s+['"].*\/(run-machine|orchestrator|task-machine)/.test(content), `${file} drives Relay Core`).toBe(false);
    }
  });

  it('the Claude adapter never imports fusion-engine, server, or browser UI', () => {
    for (const file of claudeFiles) {
      const content = read(file);
      expect(/fusion-engine|from\s+['"].*server\//.test(content), `${file} imports backend`).toBe(false);
      expect(/from\s+['"]react|from\s+['"]zustand|@supabase/.test(content), `${file} imports UI/provider SDKs`).toBe(false);
    }
  });

  it('no adapter source contains dangerous flags, generic Bash, push, deploy, or publish by default', () => {
    for (const file of claudeFiles) {
      const content = read(file);
      expect(/dangerously-skip-permissions/.test(content), `${file} references skip-permissions`).toBe(false);
    }
    // Bash is on the forbidden-tools list, never the allowed list.
    const perms = read(join(claudeDir, 'permission-compiler.ts'));
    expect(perms).toContain("'Bash'");
    expect(perms).toMatch(/FORBIDDEN_TOOLS/);
    // Only the process runner spawns the Claude executable; it is shell-free.
    const runner = read(join(claudeDir, 'process-runner.ts'));
    expect(runner).toContain('shell: false');
    expect(runner).not.toMatch(/shell:\s*true/);
  });

  it('every TypeScript child-stdin writer under src and relay-bridge listens for a broken pipe', () => {
    // THE DEFECT THIS PINS, and it is a DIVERGENCE rather than an oversight:
    // the reviewer's runner attached this from the start, the Claude runner did
    // not, and the MCP transport was cleared by an author who believed a write
    // callback suppressed the stream's `error` event. It does not — Node
    // delivers both — so a child exiting mid-write crashed the host with an
    // uncaught EPIPE. A try/catch cannot catch it; the error is asynchronous.
    //
    // ENUMERATED FROM THE TREE, not from a list of directories. An earlier
    // version checked two hardcoded connectors and would have stayed green
    // while the third writer carried the live bug — which is exactly what
    // happened.
    // The lookbehind is TOKEN-BOUNDED. `(?<!process)` alone also excluded
    // a writer whose variable name merely ENDS in those seven characters —
    // `sub`+`process`, `child`+`process`, both ordinary Node names — so a writer
    // could be skipped by a test whose whole job is to skip nothing. Named in
    // pieces on purpose: spelled out, this comment matches the pattern it
    // describes, and the test passed only because its own file is excluded by
    // name.
    const WRITE = /(?<!(?<![A-Za-z0-9_$])process)\.stdin[?]?\.write\(/;
    const sources = [...walk(join(root, 'src')), ...walk(join(root, 'relay-bridge'))]
      .filter((f) => !/\.test\.tsx?$/.test(f));
    const writers = sources.filter((f) => WRITE.test(read(f)));
    // If this ever finds nothing, the pattern has drifted, not the risk.
    expect(
      writers.length,
      `expected at least 3 child-stdin writers, found ${writers.length} — if one was `
      + 'legitimately removed, lower this floor deliberately rather than deleting the check',
    ).toBeGreaterThanOrEqual(3);

    const GUARD = /(?<!(?<![A-Za-z0-9_$])process)\.stdin[?]?\.(?:on|once|addListener)\(\s*['"]error['"]/;
    for (const file of writers) {
      const source = read(file);
      const where = file.slice(root.length + 1);
      expect(GUARD.test(source), `${where} writes to a child stdin without listening for 'error'`)
        .toBe(true);
      // …and the listener must precede the first write, or the window it
      // exists to close is still open when the write happens.
      expect(
        source.search(GUARD),
        `${where} attaches its stdin guard after the first write`,
      ).toBeLessThan(source.search(WRITE));
    }
  });

  it('nothing describing a SCHEDULE\'s unfinished runs calls them "in flight"', () => {
    // The edit endpoint reports the runs a schedule change must not disturb.
    // Nothing in this build dispatches a scheduled run, so those runs have not
    // executed — and three commits in a row declared this wording fixed while
    // leaving instances behind, twice because the phrase was line-WRAPPED and a
    // line-based grep cannot see it. So the check is here rather than in a
    // commit message: it normalises whitespace, and it names the files that
    // describe this list rather than the whole repository, where "in flight"
    // is correct about work that genuinely executes.
    const describing = [
      relay(join('mission', 'loop', 'runtime', 'loop-operations.ts')),
      relay(join('mission', 'loop', 'runtime', 'loop-engine.test.ts')),
      join(root, 'relay-bridge', 'cron-routes.ts'),
      join(root, 'relay-bridge', 'cron-service.ts'),
      join(root, 'docs', 'relay', 'CRON_LOOPS.md'),
    ];
    // COMMENT MARKERS COME OUT FIRST. Collapsing whitespace alone only defeats
    // wrapping in prose: inside `//` and `/** */` a wrap inserts a marker, so
    // "in\n * flight" normalises to "in * flight" and slips through. Both
    // files that carry an occurrence carry it inside a comment, which is to say
    // the first version of this check could not see the form that defeated the
    // greps before it — and the moment it could, it found one nobody had named.
    //
    // The separator is `[-\s]*` because the phrase is spelled BOTH ways: a
    // wrap at the hyphen of "in-flight" leaves "in- flight", which a
    // single-separator pattern misses, and that is the likeliest wrap of all.
    const flatten = (text: string): string =>
      text.replace(/\s*(?:\/\/+|\*+|>+)\s*/gu, ' ').replace(/\s+/gu, ' ');
    // The two deliberate survivors: the contrast itself, and `activeRunsFor`,
    // which is about runs that really are executing.
    const ALLOWED = [/NOT "in flight"/, /may run BESIDE work in flight/];
    for (const file of describing) {
      const flat = flatten(read(file));
      for (const match of flat.matchAll(/\bin[-\s]*flight\b/giu)) {
        // ADJACENT AND WITHIN THE SENTENCE — both bounds matter. A chunk-scoped
        // allowance let a bad phrasing pass by sharing a sentence with the
        // contrast; a fixed window alone would be WIDER than a short sentence
        // and exempt the one next to it, which is a loosening rather than the
        // tightening it looks like. Clamped at the nearest full stop on each
        // side, so the allowance can never reach past the sentence it is in.
        const from = Math.max(flat.lastIndexOf('.', match.index) + 1, match.index - 80);
        const stop = flat.indexOf('.', match.index);
        const to = Math.min(stop === -1 ? flat.length : stop, match.index + 80);
        const window = flat.slice(from, Math.max(to, match.index + match[0].length));
        expect(
          ALLOWED.some((allowed) => allowed.test(window)),
          `${file.slice(root.length + 1)} calls a schedule's unfinished runs "in flight": ${window.trim().slice(0, 140)}`,
        ).toBe(true);
      }
    }
  });

  it('the transport marks its broken-pipe failure as a consequence', () => {
    // The rule that lets a later observation replace it is unit-tested; THIS
    // is the wiring, and without it that rule never fires. Removing the marker
    // failed no test until this one existed.
    const transport = read(relay(join('mcp', 'transports', 'stdio-process-transport.ts')));
    const handler = transport.slice(transport.indexOf("child.stdin.on('error'"));
    expect(handler.slice(0, 600)).toContain('CONSEQUENTIAL_DETAIL');
  });

  it('the adapter strips API-key / provider credentials from the child environment', () => {
    const env = read(join(claudeDir, 'environment.ts'));
    expect(env).toContain('ANTHROPIC_API_KEY');
    expect(env).toContain('ANTHROPIC_AUTH_TOKEN');
    expect(env).toContain('CLAUDE_CODE_USE_BEDROCK');
  });

  it('browser prototype modules cannot import the Claude adapter', () => {
    for (const name of ['main.tsx', 'RelayApp.tsx', 'StagePanel.tsx', 'PipelineRail.tsx']) {
      expect(/from\s+['"].*connectors\/claude-code/.test(read(relay(name))), `${name} imports the Claude adapter`).toBe(false);
    }
  });

  it('simulation adapters remain unchanged (no live/child_process leakage)', () => {
    const simulated = read(relay(join('connectors', 'simulated.ts')));
    expect(/child_process|connectors\/claude-code/.test(simulated)).toBe(false);
    expect(simulated).toContain("provenance: 'simulated'");
  });
});

describe('Manual Task boundaries (Prompt 6.1)', () => {
  const cliFiles = walk(relay(CLI_ROOT)).filter((f) => !f.endsWith('.test.ts'));
  const connectorFiles = walk(relay('connectors')).filter((f) => !f.endsWith('.test.ts') && !f.includes(join('connectors', 'claude-code')));

  it('the CLI never decides manual-task safety, verification, or resume', () => {
    for (const file of cliFiles) {
      const content = read(file);
      expect(/from\s+['"]\.\.\/core\/manual-task/.test(content), `${file} imports the manual-task compiler`).toBe(false);
      expect(/compileManualTask|validateManualTaskText|looksLikeSecret/.test(content), `${file} contains manual-task decision logic`).toBe(false);
      expect(/record-manual-verification/.test(content), `${file} drives manual verification`).toBe(false);
      expect(/validatedByRelay\s*:\s*true/.test(content), `${file} constructs a canonical ManualTask`).toBe(false);
    }
  });

  it('adapters may request human help but never publish or compile user instructions', () => {
    for (const file of connectorFiles) {
      const content = read(file);
      expect(/from\s+['"]\.\.\/(core|ledger|cli)\//.test(content), `${file} imports orchestration modules`).toBe(false);
      expect(/compileManualTask/.test(content), `${file} compiles manual tasks`).toBe(false);
      expect(/validatedByRelay/.test(content), `${file} claims relay validation`).toBe(false);
    }
    // The port keeps the request untrusted by construction.
    expect(read(relay('connectors/ports.ts'))).toContain('manualActionRequest?: unknown');
  });

  it('the untrusted-request gate exists at the protocol boundary and in core', () => {
    expect(read(relay('protocol/contracts.ts'))).toContain('checkManualActionRequest');
    const compiler = read(relay('core/manual-task.ts'));
    expect(compiler).toContain('checkManualActionRequest');
    expect(compiler).toContain('rejected');
  });
});

describe('L — security invariants', () => {
  const CREDENTIAL_FIELD = /\b(apiKey|api_key|accessToken|access_token|refreshToken|clientSecret|privateKey|password|bearer)\b\s*[:?]/;

  it('no credential-shaped field exists in any serializable core contract', () => {
    for (const file of files.filter((f) => !f.endsWith('.test.ts'))) {
      expect(CREDENTIAL_FIELD.test(read(file)), `${file} declares a credential-shaped field`).toBe(false);
    }
  });

  it('session references are opaque by contract (documented, no token material)', () => {
    const contracts = read(relay('protocol/contracts.ts'));
    expect(contracts).toContain('NEVER credentials');
    expect(contracts).not.toMatch(/token\s*:/i);
  });

  it('error messages carry codes and safe details, never environment dumps', () => {
    const errors = read(relay('protocol/errors.ts'));
    expect(errors).toContain('never secrets');
    expect(/process\.env/.test(errors)).toBe(false);
  });

  it('hidden-reasoning rejection is wired into report and event parsing', () => {
    const envelopes = read(relay('protocol/envelopes.ts'));
    expect(envelopes.match(/rejectHiddenReasoning/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('the prototype UI cannot become the source of canonical state (no core imports from prototype)', () => {
    for (const file of files) {
      const content = read(file);
      expect(/from\s+['"]\.\.\/(domain|state)\//.test(content), `${file} imports prototype modules`).toBe(false);
      expect(/from\s+['\"].*\/(RelayApp|StagePanel|PipelineRail)['\"]|StagePanel|PipelineRail/.test(content), `${file} references prototype UI`).toBe(false);
    }
  });

  it('no Sunday model-orchestration logic enters Relay Core', () => {
    for (const file of files) {
      expect(/from\s+['"]@\/core\//.test(read(file)), `${file} imports Sunday app core`).toBe(false);
    }
  });
});
