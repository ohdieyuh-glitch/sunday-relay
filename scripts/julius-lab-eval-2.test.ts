import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseLiveMissionContract } from '../relay-bridge/julius-live-mission';
import { JULIUS_RESEARCH_ROLES } from '../src/relay/mission/julius/julius-research-policy';
import {
  juliusTaskContractBindingDigest,
  seedJuliusTaskContract,
  type JuliusTaskContract,
} from '../src/relay/mission/julius/julius-task-contract';

/**
 * AUXILIARY LAB EVALUATION B — REGRESSION UNDER CHANGE — HELD TO WHAT IT CLAIMS.
 *
 * The mission adds two terms to the task contract, a module on every paid run's
 * dispatch path, and gates locking on one of them in the domain and in the store.
 * It claims four things that only mean something if the fixture proves them:
 *
 *   1. the ceilings and the grant are this mission's own;
 *   2. the slice is six tracked files closed under their runtime imports, and
 *      the stored rows it carries were written by THIS code — not fabricated —
 *      so they are a faithful picture of what a run in flight holds;
 *   3. the existing specification is green against the live modules as
 *      committed, and the new one fails against them for the feature's reasons;
 *   4. the existing specification is a real guard: three mutants of the live
 *      module, each reproducing the root cause of an obvious way to add the
 *      terms and none containing any of the feature, fail it by name.
 *
 * A private reference implementation passed both specifications in full, and
 * three natural implementations passed every new case while failing the existing
 * one; that measurement is recorded in the mission's commit. Neither the
 * reference nor those implementations is committed anywhere in this repository:
 * the deliverable is the mission's to produce.
 */

const ROOT = resolve(import.meta.dirname, '..');
const MISSION = 'julius-lab-eval-2';
const MISSION_DIR = join(ROOT, '.github/julius-missions', MISSION);
const J = 'src/relay/mission/julius';
const CONTRACT_MODULE = `${J}/julius-task-contract.ts`;
const STORE_MODULE = `${J}/julius-memory-store.ts`;
const EXISTING_SPEC = `${J}/julius-task-contract.existing.test.ts`;
const TERMS_SPEC = `${J}/julius-task-contract.terms.test.ts`;
const STORED_ROWS = `${J}/julius-task-contract.stored-rows.json`;
const BRIEF = `${J}/CONTRACT_TERMS_BRIEF.md`;
const CHECK = 'scripts/julius-live-contract-check.mjs';

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const readSeed = (relative: string): string => readFileSync(join(MISSION_DIR, 'seed', relative), 'utf8');
const contractSource = readFileSync(join(MISSION_DIR, 'contract.json'), 'utf8');
const contract = JSON.parse(contractSource) as Record<string, unknown>;

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

const slicePaths = (): readonly string[] => readFileSync(join(MISSION_DIR, 'slice.txt'), 'utf8')
  .split('\n').map((line) => line.replace(/#.*$/u, '').trim()).filter((line) => line.length > 0);

/* ------------------------------------------------ A. bounds and grants */

describe('the mission asks for ceilings a deployment granted it, and nobody else gets them', () => {
  it('parses through the live entrypoint and states its own ceilings', () => {
    const parsed = parseLiveMissionContract(contractSource);
    expect(parsed.ok, parsed.ok ? '' : parsed.problem).toBe(true);
    expect(contract.limits).toEqual({ spendUsd: 60, repairCycles: 3, architectMaxOutputTokens: 20_000 });
    expect(contract.markerNamespace).toBe(MISSION);
    expect(String(contract.testCommand)).toContain(EXISTING_SPEC);
    expect(String(contract.testCommand)).toContain(TERMS_SPEC);
  });

  const runCheck = (document: unknown): { code: number; output: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-lab2-'));
    scratch.push(dir);
    const path = join(dir, 'contract.json');
    writeFileSync(path, JSON.stringify(document, null, 2));
    try {
      return { code: 0, output: execFileSync('node', [join(ROOT, CHECK), path], { encoding: 'utf8' }) };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };

  it('passes the real checker as committed', () => {
    expect(runCheck(contract).code).toBe(0);
  });

  it('the identical document under an ungranted namespace is refused on spend, repairs AND research', () => {
    const result = runCheck({ ...contract, markerNamespace: 'julius-not-granted-anything' });
    expect(result.code).toBe(1);
    expect(result.output).toContain('spendUsd');
    expect(result.output).toContain('repairCycles');
    expect(result.output).toContain('a contract cannot grant itself research authority');
  });

  it('eleven of its twelve criteria block, and the stored rows, the replay and the plan are among them', () => {
    const criteria = contract.acceptanceCriteria as readonly { id: string; blocking: boolean }[];
    expect(criteria).toHaveLength(12);
    expect(criteria.filter((criterion) => criterion.blocking)).toHaveLength(11);
    for (const id of ['criterion-stored-rows', 'criterion-replay', 'criterion-plan-interaction', 'criterion-evidence-both', 'criterion-unweakened']) {
      const criterion = criteria.find((entry) => entry.id === id);
      expect(criterion, id).toBeDefined();
      expect(criterion!.blocking, id).toBe(true);
    }
  });
});

/* ------------------------------------------- B. the workspace, as declared */

describe('the slice is six tracked files closed under their runtime imports, and the stored rows are real', () => {
  it('the slice names the two live deliverables and the store’s four dependencies, all tracked here', () => {
    expect(slicePaths()).toEqual([
      CONTRACT_MODULE, STORE_MODULE,
      `${J}/julius-runtime.ts`, `${J}/julius-recovery.ts`, `${J}/julius-repair-lineage.ts`,
      // The repair lineage walks paused segments at runtime.
      `${J}/julius-segment-lineage.ts`,
    ]);
    for (const path of slicePaths()) {
      expect(() => execFileSync('git', ['-C', ROOT, 'ls-files', '--error-unmatch', path], { stdio: 'pipe' }), path).not.toThrow();
    }
  });

  /**
   * CLOSED, measured rather than asserted. Node's type stripping erases an
   * `import type` and a braced import whose every specifier is `type`, so only
   * the remaining relative imports must resolve inside the slice, and the only
   * bare import may be the built-in the contract module already uses.
   */
  it('every runtime import of a sliced file resolves inside the slice, and the only other import is node:crypto', () => {
    const slice = new Set(slicePaths().map((path) => normalize(path)));
    const bare = new Set<string>();
    for (const path of slicePaths()) {
      const source = read(path);
      for (const match of source.matchAll(/^(?:import|export)\s+(?!type\b)([\s\S]*?)\sfrom\s+'([^']+)';?/gmu)) {
        const clause = match[1]!.trim();
        const braces = /^\{([\s\S]*)\}$/u.exec(clause);
        if (braces && braces[1]!.split(',').map((name) => name.trim()).filter(Boolean).every((name) => name.startsWith('type '))) continue;
        const specifier = match[2]!;
        if (!specifier.startsWith('.')) { bare.add(specifier); continue; }
        const target = normalize(join(dirname(path), `${specifier}.ts`));
        expect(slice.has(target), `${path} imports ${specifier}, which is not in the slice`).toBe(true);
      }
    }
    expect([...bare]).toEqual(['node:crypto']);
  });

  const stored = JSON.parse(readSeed(STORED_ROWS)) as {
    capturedWith: string; missionTerms: Parameters<typeof seedJuliusTaskContract>[0];
    seededDraft: JuliusTaskContract; seededDraftDigest: string;
    lockedRevision: JuliusTaskContract; pendingDraft: JuliusTaskContract; pendingDraftDigest: string;
  };

  it('the stored rows were written by this code: the committed module reproduces every row and every digest', () => {
    const seeded = seedJuliusTaskContract(stored.missionTerms);
    expect(seeded.seeded).toBe(true);
    if (!seeded.seeded) return;
    expect(seeded.contract).toEqual(stored.seededDraft);
    expect(juliusTaskContractBindingDigest(stored.seededDraft)).toBe(stored.seededDraftDigest);
    expect(juliusTaskContractBindingDigest(stored.lockedRevision)).toBe(stored.lockedRevision.bindingDigest);
    expect(juliusTaskContractBindingDigest(stored.pendingDraft)).toBe(stored.pendingDraftDigest);
    expect(stored.lockedRevision.state).toBe('LOCKED');
  });

  it('no sliced file and no seed shadows another, and nothing seeded exists in the repository', () => {
    for (const path of [EXISTING_SPEC, TERMS_SPEC, STORED_ROWS, BRIEF]) {
      expect(existsSync(join(MISSION_DIR, 'seed', path)), `${path} must be seeded`).toBe(true);
      expect(slicePaths()).not.toContain(path);
      expect(existsSync(join(ROOT, path)), `${path} is the mission’s, not the repository’s`).toBe(false);
    }
  });
});

/* --------------------------------------- C. evidence, not the answer */

describe('the Architect is given the interaction to foresee, and neither specification gives away the answer', () => {
  const brief = readSeed(BRIEF);
  const prose = brief.replace(/\s+/gu, ' ');

  it('the brief states the operational facts the interaction lives in', () => {
    expect(prose).toContain('re-derives the digest from the stored terms');
    expect(prose).toContain('replays its bootstrap');
    expect(prose).toContain('runs in flight');
    expect(prose).toContain('julius-task-contract.stored-rows.json');
  });

  it('the brief contains no code and no hint of how compatibility is achieved', () => {
    expect(brief).not.toMatch(/```/u);
    for (const hint of ['optional', '?:', '??', 'undefined', 'normali']) expect(brief.toLowerCase(), hint).not.toContain(hint);
  });

  it('the existing specification never mentions the new terms, and the new one never mentions the stored rows', () => {
    const existing = readSeed(EXISTING_SPEC);
    expect(existing).not.toContain('assumptions');
    expect(existing).not.toContain('openQuestions');
    const terms = readSeed(TERMS_SPEC);
    expect(terms).not.toContain('stored-rows');
    expect(terms).not.toContain('STORED');
  });

  it('the objective requires the plan to foresee the interaction without naming where it is', () => {
    const objective = String(contract.objective);
    expect(objective).toContain('THE PLAN MUST FORESEE THE INTERACTION');
    for (const giveaway of ['seed', 'replay', 'digest of rows', 're-derive']) expect(objective, giveaway).not.toContain(giveaway);
  });
});

/* -------------------------------- D. the specifications, against the tree */

describe('the existing specification is green as committed, the new one fails for the feature’s reasons, and the guard is real', () => {
  const HARNESS = join(ROOT, '.github/julius-mission-slice');

  const provision = (mutate?: (source: string) => string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-lab2-run-'));
    scratch.push(dir);
    const rev = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('sh', ['-c', `git -C '${ROOT}' archive --format=tar ${rev} -- ${slicePaths().join(' ')} | tar -x -C '${dir}'`]);
    mkdirSync(join(dir, '.julius'), { recursive: true });
    for (const file of ['resolve.mjs', 'loader.mjs']) cpSync(join(HARNESS, file), join(dir, '.julius', file));
    cpSync(join(MISSION_DIR, 'seed'), dir, { recursive: true });
    if (mutate !== undefined) {
      const path = join(dir, CONTRACT_MODULE);
      writeFileSync(path, mutate(readFileSync(path, 'utf8')));
    }
    return dir;
  };

  const runSpec = (dir: string, spec: string): { code: number; output: string } => {
    try {
      return { code: 0, output: execFileSync(process.execPath, ['--import', './.julius/loader.mjs', '--test', '--test-reporter=tap', spec], { cwd: dir, encoding: 'utf8' }) };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };

  const failedCases = (output: string): readonly string[] =>
    [...output.matchAll(/^not ok \d+ - (.+)$/gmu)].map((match) => match[1]!.trim());
  const passedCases = (output: string): readonly string[] =>
    [...output.matchAll(/^ok \d+ - (.+)$/gmu)].map((match) => match[1]!.trim());

  const mutation = (before: string, after: string) => (source: string): string => {
    expect(source, `the mutation must hit the line it targets: ${before.slice(0, 60)}`).toContain(before);
    // A replacer FUNCTION: a replacement string would read `$'` in `'$'` as "the text after the match".
    return source.replace(before, () => after);
  };

  it('the EXISTING specification is fully green against the live modules as committed', () => {
    const result = runSpec(provision(), EXISTING_SPEC);
    expect(result.code, result.output).toBe(0);
    expect(failedCases(result.output)).toEqual([]);
    expect(passedCases(result.output).length).toBeGreaterThanOrEqual(30);
  }, 60_000);

  it('the NEW specification fails against them because the feature is absent, not because anything fails to load', () => {
    const result = runSpec(provision(), TERMS_SPEC);
    expect(result.code).not.toBe(0);
    const failed = failedCases(result.output);
    expect(failed.length).toBeGreaterThanOrEqual(10);
    for (const name of [
      'a worker may propose the assumptions an agreement rests on and the questions it leaves open, kept in order and trimmed',
      'an agreement with an open question cannot lock, whatever the evaluator said, and no binding is published',
      'the reviewer is charged with the assumptions the agreement rests on, in order',
      'the store refuses to lock a revision with an open question, even when handed the right digest',
    ]) expect(failed, name).toContain(name);
    expect(result.output).not.toMatch(/SyntaxError|ERR_MODULE_NOT_FOUND/u);
  }, 60_000);

  const PLAIN = 'the sanitiser keeps what a worker may propose, trimmed';

  it('bumping the compiler version for the new shape stops every run in flight, and the guard names it', () => {
    const result = runSpec(provision(mutation(
      "export const JULIUS_TASK_CONTRACT_VERSION = 'julius-task-contract.v1' as const;",
      "export const JULIUS_TASK_CONTRACT_VERSION = 'julius-task-contract.v2' as const;",
    )), EXISTING_SPEC);
    const failed = failedCases(result.output);
    expect(failed).toContain('a stored locked row still hashes to the binding it was locked with');
    expect(failed).toContain('a stored locked row, handed back to the store as it was written, reads as the task’s current contract');
    expect(failed).toContain('the same mission still seeds the same contract — a replayed bootstrap is not a new agreement');
    expect(passedCases(result.output)).toContain(PLAIN);
  }, 60_000);

  it('a seed that states a new term, even an empty one, turns a replayed bootstrap into a conflict, and the guard names it', () => {
    const result = runSpec(provision(mutation(
      "      + 'when the authorised repair rounds are spent, or when the mission budget is exhausted.',\n",
      "      + 'when the authorised repair rounds are spent, or when the mission budget is exhausted.',\n    assumptions: [],\n",
    )), EXISTING_SPEC);
    const failed = failedCases(result.output);
    expect(failed).toContain('the same mission still seeds the same contract — a replayed bootstrap is not a new agreement');
    expect(failed).toContain('a seed replayed into a store that already holds the stored one is a replay, not a conflict');
    expect(passedCases(result.output)).toContain('a stored locked row still hashes to the binding it was locked with');
  }, 60_000);

  it('hashing an absent term as an empty one makes every stored row unreadable, and the guard names it', () => {
    const result = runSpec(provision(mutation(
      ".update(canonicalise({ version: JULIUS_TASK_CONTRACT_VERSION, terms }, '$'))",
      ".update(canonicalise({ version: JULIUS_TASK_CONTRACT_VERSION, terms: { ...terms, assumptions: [] } }, '$'))",
    )), EXISTING_SPEC);
    const failed = failedCases(result.output);
    expect(failed).toContain('a stored locked row still hashes to the binding it was locked with');
    expect(failed).toContain('a stored draft locks through the store with its stored digest, reads back as the task’s contract, and survives a restart');
    expect(passedCases(result.output)).toContain(PLAIN);
  }, 60_000);
});

/* ------------------------------------------ E. the research clause fits */

describe('the research clause is the shape of one syntax question and nothing wider', () => {
  const clause = contract.research as {
    roles: readonly string[];
    allowances: readonly { source: string; capabilities: readonly string[]; hosts: readonly string[] }[];
    missionBudget: { maxRetrievals: number; maxBytes: number };
    roleBudget: { maxRetrievals: number; maxBytes: number };
  };

  it('one source, one read capability, one host — the Node documentation — and no search', () => {
    expect(clause.allowances).toHaveLength(1);
    expect(clause.allowances[0]!.source).toBe('web');
    expect(clause.allowances[0]!.capabilities).toEqual(['read_item']);
    expect(clause.allowances[0]!.hosts).toEqual(['nodejs.org']);
  });

  it('names every slot the domain has, pinned to the domain’s own list', () => {
    expect([...clause.roles].sort()).toEqual([...JULIUS_RESEARCH_ROLES].sort());
  });

  it('the grant in the deployment table is the clause’s equal, not its superset', () => {
    const table = read(CHECK);
    const start = table.indexOf(`'${MISSION}': Object.freeze({`, table.indexOf('const MISSION_RESEARCH'));
    expect(start).toBeGreaterThan(0);
    const entry = table.slice(start);
    // The entry closes at its own two-space indent; the allowance inside it closes deeper.
    const body = entry.slice(0, entry.indexOf('\n  }),'));
    expect(body).toContain(`roles: Object.freeze([${clause.roles.map((role) => `'${role}'`).join(', ')}])`);
    expect(body).toContain("hosts: Object.freeze(['nodejs.org'])");
    const budget = (label: string): { maxRetrievals: number; maxBytes: number } => {
      const match = new RegExp(`${label}: Object\\.freeze\\(\\{ maxRetrievals: ([\\d_]+), maxBytes: ([\\d_]+) \\}\\)`, 'u').exec(body);
      expect(match, `the grant must state a ${label}`).not.toBeNull();
      const n = (text: string) => Number.parseInt(text.replace(/_/gu, ''), 10);
      return { maxRetrievals: n(match![1]!), maxBytes: n(match![2]!) };
    };
    expect(budget('missionBudget')).toEqual(clause.missionBudget);
    expect(budget('roleBudget')).toEqual(clause.roleBudget);
  });
});
