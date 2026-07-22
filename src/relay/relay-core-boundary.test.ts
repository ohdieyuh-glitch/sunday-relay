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

  it('CLI is a thin client: only the app facade, read-model types, protocol, and its own modules', () => {
    const ALLOWED = /from\s+['"](\.\/(main|interactive|render|exit-codes|index|presentation)|\.\.\/core\/app|\.\.\/protocol\/(version|ids|errors)|\.\.\/testing\/factories|node:util|node:readline)['"]/;
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
      expect(/from\s+['"]\.\.\/connectors\//.test(content), `${file} imports adapters directly`).toBe(false);
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

describe('Manual Task boundaries (Prompt 6.1)', () => {
  const cliFiles = walk(relay(CLI_ROOT)).filter((f) => !f.endsWith('.test.ts'));
  const connectorFiles = walk(relay('connectors')).filter((f) => !f.endsWith('.test.ts'));

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
