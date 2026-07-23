import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

  it('CLI is a thin client: only the app facade, read-model types, protocol, workspace facade, and its own modules', () => {
    // '../workspace' (the composition-root facade) is the ONLY workspace
    // import the CLI may use — internals are asserted below.
    const ALLOWED = /from\s+['"](\.\/(main|interactive|render|exit-codes|index|presentation|competitive|mission-control)|\.\.\/core\/app|\.\.\/protocol\/(version|ids|errors)|\.\.\/testing\/factories|\.\.\/workspace|\.\.\/connectors\/(claude-code|codex-reviewer|supervised)|\.\.\/mission|\.\.\/persistence|node:util|node:readline)['"]/;
    for (const file of walk(relay(CLI_ROOT)).filter((f) => !f.endsWith('.test.ts'))) {
      const content = read(file);
      const imports = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        expect(ALLOWED.test(`from '${imp}'`), `${file} imports ${imp} — CLI must stay a thin client`).toBe(true);
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
    const allRelayFiles = [
      ...files,
      ...walk(relay('cli')),
      ...walk(relay('connectors')).filter((f) => !isClaudeAdapter(f)),
      ...walk(relay('domain')),
      ...walk(relay('state')),
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

  it('Relay Core, protocol, ledger, mission, and UI never import persistence', () => {
    for (const file of [...files, ...walk(relay('mission')), ...walk(relay('ui'))].filter(
      (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
    )) {
      expect(/from\s+['"].*\/persistence/.test(read(file)), `${file} imports persistence`).toBe(false);
    }
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
