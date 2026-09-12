import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseLiveMissionContract } from '../relay-bridge/julius-live-mission';
import { JULIUS_RESEARCH_ROLES } from '../src/relay/mission/julius/julius-research-policy';

/**
 * LAB EVALUATION MISSION 1, HELD TO WHAT IT CLAIMS.
 *
 * The continuous qualification bought a PAUSE — one question the workspace
 * could not answer. This mission buys the next things Julius has not shown on
 * a paid path: TWO deliverables that must be implemented in dependency order,
 * a real dependency that must be imported rather than copied, a STALE NOTE in
 * the workspace that contradicts the code and must be reconciled, and ONE rule
 * the specification deliberately leaves open, which the Architect must decide
 * and record rather than let the coder guess. None of that means anything
 * unless four things are true of the fixture itself:
 *
 *   1. the ceilings and the research grant are the ones a deployment granted
 *      THIS mission, and no other mission inherits them;
 *   2. the slice really is three tracked files, the dependency really imports
 *      nothing, and the deliverables really are stubs;
 *   3. the note really contradicts the sliced module and the specification, on
 *      exactly the rules the specification pins — so reconciling it is work
 *      and not a formality — and the undecided rule really is tested by neither
 *      specification;
 *   4. the seeded specifications really refuse the wrong answers: they fail the
 *      stubs on their own cases, and they reject the one natural wrong
 *      comparator — the one that manufactures a number for every metric.
 *
 * (4) is proved by running the specifications against an ADVERSARIAL
 * comparator, not by inspecting the files. A reference implementation is
 * deliberately not committed anywhere in this repository: the deliverable is
 * the mission's to produce.
 */

const ROOT = resolve(import.meta.dirname, '..');
const MISSION = 'julius-lab-eval-1';
const MISSION_DIR = join(ROOT, '.github/julius-missions', MISSION);
const COMPARATOR = 'src/relay/mission/julius/julius-run-comparison.ts';
const RENDERER = 'src/relay/mission/julius/julius-run-comparison-text.ts';
const DEPENDENCY = 'src/relay/mission/julius/julius-cost-accounting.ts';
const COMPARATOR_SPEC = 'src/relay/mission/julius/julius-run-comparison.test.ts';
const RENDERER_SPEC = 'src/relay/mission/julius/julius-run-comparison-text.test.ts';
const NOTE = 'src/relay/mission/julius/RUN_COMPARISON_NOTES.md';
const CHECK = 'scripts/julius-live-contract-check.mjs';

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const readSeed = (relative: string): string => readFileSync(join(MISSION_DIR, 'seed', relative), 'utf8');
const contractSource = readFileSync(join(MISSION_DIR, 'contract.json'), 'utf8');
const contract = JSON.parse(contractSource) as Record<string, unknown>;

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

/** The paths `slice.txt` names, comments stripped exactly as the provisioner strips them. */
const slicePaths = (): readonly string[] => readFileSync(join(MISSION_DIR, 'slice.txt'), 'utf8')
  .split('\n').map((line) => line.replace(/#.*$/u, '').trim()).filter((line) => line.length > 0);

/* ------------------------------------------------ A. bounds and grants */

describe('the mission asks for ceilings a deployment granted it, and nobody else gets them', () => {
  it('parses through the live entrypoint and states its own ceilings', () => {
    const parsed = parseLiveMissionContract(contractSource);
    expect(parsed.ok, parsed.ok ? '' : parsed.problem).toBe(true);
    expect(contract.limits).toEqual({ spendUsd: 60, repairCycles: 3, architectMaxOutputTokens: 20_000 });
    expect(contract.markerNamespace).toBe(MISSION);
    expect(String(contract.testCommand)).toContain(COMPARATOR_SPEC);
    expect(String(contract.testCommand)).toContain(RENDERER_SPEC);
  });

  const runCheck = (document: unknown): { code: number; output: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-lab1-'));
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
    const stolen = { ...contract, markerNamespace: 'julius-not-granted-anything' };
    const result = runCheck(stolen);
    expect(result.code).toBe(1);
    expect(result.output).toContain('spendUsd');
    expect(result.output).toContain('repairCycles');
    expect(result.output).toContain('a contract cannot grant itself research authority');
  });

  it('eleven of its twelve criteria block, and the two that need a reviewer rather than a test are among them', () => {
    const criteria = contract.acceptanceCriteria as readonly { id: string; blocking: boolean }[];
    expect(criteria).toHaveLength(12);
    expect(criteria.filter((criterion) => criterion.blocking)).toHaveLength(11);
    for (const id of ['criterion-decided', 'criterion-stale-note', 'criterion-dependency']) {
      const criterion = criteria.find((entry) => entry.id === id);
      expect(criterion, `the mission is about ${id}`).toBeDefined();
      expect(criterion!.blocking, `${id}: a run may not be scored a success while skipping it`).toBe(true);
    }
  });
});

/* -------------------------------------------- B. the workspace, as declared */

describe('the slice is three tracked files, the dependency is closed, and the deliverables are stubs', () => {
  it('the slice names exactly the two deliverables and their one dependency, all tracked here', () => {
    expect(slicePaths()).toEqual([COMPARATOR, RENDERER, DEPENDENCY]);
    for (const path of slicePaths()) {
      expect(() => execFileSync('git', ['-C', ROOT, 'ls-files', '--error-unmatch', path], { stdio: 'pipe' }), path).not.toThrow();
    }
  });

  it('the dependency imports nothing, so the slice is closed at three files', () => {
    expect(read(DEPENDENCY)).not.toMatch(/^import /mu);
  });

  it('the deliverables import only each other and the dependency', () => {
    const comparatorImports = [...read(COMPARATOR).matchAll(/^import .* from '([^']+)';$/gmu)].map((match) => match[1]);
    expect(comparatorImports).toEqual(['./julius-cost-accounting']);
    const rendererImports = [...read(RENDERER).matchAll(/^import .* from '([^']+)';$/gmu)].map((match) => match[1]);
    expect(rendererImports).toEqual(['./julius-run-comparison']);
  });

  it('each deliverable is a committed stub: every exported function refuses with that module’s one sentinel', () => {
    for (const [path, sentinel, atLeast] of [
      [COMPARATOR, 'run_comparison_not_implemented', 3],
      [RENDERER, 'run_comparison_text_not_implemented', 2],
    ] as const) {
      const source = read(path);
      const exported = [...source.matchAll(/^export function (\w+)/gmu)].map((match) => match[1]);
      expect(exported.length, `${path} must export the functions to implement`).toBeGreaterThanOrEqual(atLeast);
      expect(source.match(new RegExp(sentinel, 'gu'))?.length, path).toBe(exported.length);
    }
  });

  it('the seed lays the specifications and the note beside the slice without shadowing any sliced file', () => {
    const seeded = [COMPARATOR_SPEC, RENDERER_SPEC, NOTE];
    for (const path of seeded) {
      expect(existsSync(join(MISSION_DIR, 'seed', path)), `${path} must be seeded`).toBe(true);
      expect(slicePaths(), `${path} may not shadow a sliced file`).not.toContain(path);
      expect(existsSync(join(ROOT, path)), `${path} is the mission’s, not the repository’s`).toBe(false);
    }
  });
});

/* -------------------------------------- C. the conflict and the open rule */

describe('the stale note contradicts the code on the rules the specification pins, and one rule is open', () => {
  const note = readSeed(NOTE).replace(/\s+/gu, ' ');
  const comparatorSpec = readSeed(COMPARATOR_SPEC);

  it('the note states the four rules the sliced module and the specification refuse', () => {
    expect(note).toContain('treat it as $0');
    expect(note).toContain('may be compared directly');
    expect(note).toContain('contributes 0');
    expect(note).toContain('Ticks default to 0');
  });

  it('the sliced dependency states the rule that settles the note, in its own header', () => {
    const header = read(DEPENDENCY).replace(/\s*\*\s*/gu, ' ');
    expect(header).toContain('A COST NOBODY REPORTED IS NOT A COST OF ZERO');
  });

  it('the specification pins the refusal for each of the four, by name', () => {
    for (const name of [
      'an incomplete known cost is UNKNOWN, never a delta between two floors',
      'money under different allocation policies is NOT COMPARABLE, even when both are complete',
      'a role absent from one run is UNKNOWN there, never a cost of zero',
      'unknown ticks are UNKNOWN, never zero',
    ]) {
      expect(comparatorSpec, name).toContain(`test('${name}'`);
    }
  });

  it('the objective names the open rule, and neither specification tests it', () => {
    expect(String(contract.objective)).toContain('MEASURED_FROM_USAGE');
    expect(comparatorSpec).not.toContain('MEASURED_FROM_USAGE');
    expect(readSeed(RENDERER_SPEC)).not.toContain('MEASURED_FROM_USAGE');
  });

  it('the objective tells the worker to reconcile the note and to decide, rather than to guess', () => {
    const objective = String(contract.objective);
    expect(objective).toContain('correct those sentences in the note');
    expect(objective).toContain('A comparator that never mentions the question has not decided it');
  });
});

/* ------------------------------------ D. the specifications refuse wrong answers */

describe('the seeded specifications refuse the wrong answers', () => {
  const HARNESS = join(ROOT, '.github/julius-mission-slice');

  /**
   * THE PROVISIONER'S OWN STEPS, minus the parts that need root: archive the
   * slice from a REVISION (never the working tree), lay the loader beside it,
   * then the mission's seed. `comparator` replaces the sliced comparator, which
   * is what an adversarial comparator is.
   */
  const provision = (comparator?: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-lab1-run-'));
    scratch.push(dir);
    const rev = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('sh', ['-c', `git -C '${ROOT}' archive --format=tar ${rev} -- ${slicePaths().join(' ')} | tar -x -C '${dir}'`]);
    mkdirSync(join(dir, '.julius'), { recursive: true });
    for (const file of ['resolve.mjs', 'loader.mjs']) cpSync(join(HARNESS, file), join(dir, '.julius', file));
    cpSync(join(MISSION_DIR, 'seed'), dir, { recursive: true });
    if (comparator !== undefined) {
      mkdirSync(dirname(join(dir, COMPARATOR)), { recursive: true });
      writeFileSync(join(dir, COMPARATOR), comparator);
    }
    return dir;
  };

  /** The mission's own `testCommand`, run where the mission would run it. */
  const runSpec = (dir: string): { code: number; output: string } => {
    const [command, ...args] = String(contract.testCommand).split(' ');
    try {
      return { code: 0, output: execFileSync(command!, [...args, '--test-reporter=tap'], { cwd: dir, encoding: 'utf8' }) };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };

  const failedCases = (output: string): readonly string[] =>
    [...output.matchAll(/^not ok \d+ - (.+)$/gmu)].map((match) => match[1]!.trim());
  const passedCases = (output: string): readonly string[] =>
    [...output.matchAll(/^ok \d+ - (.+)$/gmu)].map((match) => match[1]!.trim());

  it('against the stubs the specifications FAIL, on their own cases rather than on a load error', () => {
    const result = runSpec(provision());
    expect(result.code, 'a mission whose tests already pass buys nothing').not.toBe(0);
    const failed = failedCases(result.output);
    expect(failed.length, 'the specifications must bite the stubs broadly').toBeGreaterThan(30);
    expect(result.output, 'the comparator must fail on its stub, not on an import').toContain('run_comparison_not_implemented');
    expect(result.output, 'and so must the renderer').toContain('run_comparison_text_not_implemented');
  }, 60_000);

  /**
   * THE NATURAL WRONG ANSWER: a comparator that produces a DELTA for every
   * metric. It reads an absent number as zero, a floor as a total, and two
   * allocation policies as one. It is not a broken comparator — every value it
   * returns is well formed and it gets the plain cases right — and the whole
   * product is the claim that this is wrong.
   */
  const MANUFACTURING = `
export const JULIUS_RUN_COMPARISON_VERSION = 'julius-run-comparison.v1';
export const JULIUS_RUN_STATES = ['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'];
export const JULIUS_COMPARISON_KINDS = ['DELTA', 'UNKNOWN', 'NOT_COMPARABLE'];
export const JULIUS_COMPARISON_DIRECTIONS = ['IMPROVED', 'REGRESSED', 'UNCHANGED', 'NEUTRAL'];
export const JULIUS_OUTCOME_DIRECTIONS = ['IMPROVED', 'REGRESSED', 'UNCHANGED', 'UNKNOWN'];
export const JULIUS_METRIC_POLARITIES = ['LOWER_IS_BETTER', 'HIGHER_IS_BETTER', 'NEUTRAL'];
export const JULIUS_COMPARED_METRICS = ['knownUsdMicros', 'estimatedUsdMicros', 'unknownComponents', 'components', 'ticks'];
export const JULIUS_METRIC_POLARITY = Object.freeze({ knownUsdMicros: 'LOWER_IS_BETTER', estimatedUsdMicros: 'LOWER_IS_BETTER', unknownComponents: 'LOWER_IS_BETTER', components: 'NEUTRAL', ticks: 'LOWER_IS_BETTER' });
export function safeJuliusRunState(value) { return JULIUS_RUN_STATES.includes(value) ? value : 'UNKNOWN'; }
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
export function compareJuliusMetric(metric, before, after) {
  const b = num(before); const a = num(after); const delta = a - b;
  const polarity = JULIUS_METRIC_POLARITY[metric];
  const direction = delta === 0 ? 'UNCHANGED' : polarity === 'NEUTRAL' ? 'NEUTRAL' : (polarity === 'LOWER_IS_BETTER') === (delta < 0) ? 'IMPROVED' : 'REGRESSED';
  return { kind: 'DELTA', before: b, after: a, delta, direction };
}
const rank = (state) => (state === 'COMPLETED' ? 1 : 0);
const EMPTY = { knownUsdMicros: 0, estimatedUsdMicros: 0, unknownComponents: 0, components: 0 };
export function compareJuliusRuns(before, after) {
  const roles = [...new Set([...before.cost.byRole.map((r) => r.role), ...after.cost.byRole.map((r) => r.role)])]
    .sort((x, y) => (x === null ? 1 : y === null ? -1 : x < y ? -1 : x > y ? 1 : 0));
  const byRole = roles.map((role) => {
    const b = before.cost.byRole.find((r) => r.role === role) ?? EMPTY;
    const a = after.cost.byRole.find((r) => r.role === role) ?? EMPTY;
    return { role,
      knownUsdMicros: compareJuliusMetric('knownUsdMicros', b.knownUsdMicros, a.knownUsdMicros),
      estimatedUsdMicros: compareJuliusMetric('estimatedUsdMicros', b.estimatedUsdMicros, a.estimatedUsdMicros),
      unknownComponents: compareJuliusMetric('unknownComponents', b.unknownComponents, a.unknownComponents),
      components: compareJuliusMetric('components', b.components, a.components) };
  });
  const direction = rank(after.state) > rank(before.state) ? 'IMPROVED' : rank(after.state) < rank(before.state) ? 'REGRESSED' : 'UNCHANGED';
  return { version: JULIUS_RUN_COMPARISON_VERSION, before: before.runId, after: after.runId,
    outcome: { before: before.state, after: after.state, direction }, moneyComparable: true,
    ticks: compareJuliusMetric('ticks', before.ticks, after.ticks),
    knownUsdMicros: compareJuliusMetric('knownUsdMicros', before.cost.knownUsdMicros, after.cost.knownUsdMicros),
    estimatedUsdMicros: compareJuliusMetric('estimatedUsdMicros', before.cost.estimatedUsdMicros, after.cost.estimatedUsdMicros),
    unknownComponents: compareJuliusMetric('unknownComponents', before.cost.unknownComponents.length, after.cost.unknownComponents.length),
    components: compareJuliusMetric('components', before.cost.components.length, after.cost.components.length),
    byRole, scorable: true };
}
`;

  const REFUSAL_CASES = [
    'an incomplete known cost is UNKNOWN, never a delta between two floors',
    'money under different allocation policies is NOT COMPARABLE, even when both are complete',
    'an unknown allocation policy makes money NOT COMPARABLE',
    'a role absent from one run is UNKNOWN there, never a cost of zero',
    'unknown ticks are UNKNOWN, never zero',
    'a metric missing on one side is UNKNOWN and names the side, never zero',
    'an unknown state makes the outcome UNKNOWN and the comparison unscorable',
  ];

  it('a comparator that manufactures a number for every metric is rejected, by the cases about refusal', () => {
    const result = runSpec(provision(MANUFACTURING));
    expect(result.code).not.toBe(0);
    const failed = failedCases(result.output);
    for (const name of REFUSAL_CASES) {
      expect(failed, `"${name}" did not discriminate against a manufacturing comparator`).toContain(name);
    }
    // AND IT IS NOT VACUOUS IN THE OTHER DIRECTION: the same comparator gets
    // the plain cases right, so the failures above are about refusal rather
    // than about the comparator being broken.
    expect(passedCases(result.output)).toContain('identical complete runs compare as unchanged on every metric, and are scorable');
    expect(passedCases(result.output)).toContain('a lower known cost after is an improvement, with the mission floor never in play');
    expect(passedCases(result.output)).toContain('a metric compared on both sides is a DELTA of after minus before');
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

  it('the budget is sized for every slot, and cannot fund browsing', () => {
    expect(clause.roleBudget.maxRetrievals * clause.roles.length).toBe(clause.missionBudget.maxRetrievals);
    expect(clause.roleBudget.maxRetrievals).toBeLessThanOrEqual(2);
    expect(clause.missionBudget.maxRetrievals).toBeLessThanOrEqual(6);
    expect(clause.roleBudget.maxBytes).toBeLessThanOrEqual(clause.missionBudget.maxBytes);
  });

  it('the grant in the deployment table is the clause’s equal, not its superset', () => {
    const table = read(CHECK);
    const start = table.indexOf(`'${MISSION}': Object.freeze({`, table.indexOf('const MISSION_RESEARCH'));
    expect(start, 'the mission must be granted research by name').toBeGreaterThan(0);
    const entry = table.slice(start);
    const body = entry.slice(0, entry.indexOf('}),\n});'));
    expect(body).toContain(`roles: Object.freeze([${clause.roles.map((role) => `'${role}'`).join(', ')}])`);
    expect(body).toContain("hosts: Object.freeze(['nodejs.org'])");
    expect(body).toContain("capabilities: Object.freeze(['read_item'])");
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
