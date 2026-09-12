import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseLiveMissionContract } from '../relay-bridge/julius-live-mission';
import { JULIUS_RESEARCH_ROLES } from '../src/relay/mission/julius/julius-research-policy';

/**
 * THE FIRST CONTINUOUS QUALIFICATION, HELD TO WHAT IT CLAIMS.
 *
 * Missions 2 through 5 bought plan → build → review. This one is specified to
 * buy a PAUSE: one requirement it cannot settle from its own workspace, which
 * the Coding Agent must establish rather than guess. That is a different
 * capability and a different kind of evidence, and it only means anything if
 * three things are true of the fixture itself:
 *
 *   1. the ceilings it asks for are the ones a deployment granted IT, and no
 *      other mission inherits them;
 *   2. the question really is unanswerable from the slice — not merely
 *      inconvenient, and not answerable by reading the workspace carefully;
 *   3. the seeded specification really refuses the wrong answers, rather than
 *      being satisfiable by any reader that returns something.
 *
 * (3) is proved by running the specification against ADVERSARIAL readers — the
 * two natural wrong answers — rather than by inspecting the file. A reference
 * implementation is deliberately not committed anywhere in this repository: the
 * deliverable is the mission's to produce.
 */

const ROOT = resolve(import.meta.dirname, '..');
const MISSION = 'julius-continuous-1';
const MISSION_DIR = join(ROOT, '.github/julius-missions', MISSION);
const DELIVERABLE = 'src/relay/mission/julius/julius-bundle-cell.ts';
const SPEC = 'src/relay/mission/julius/julius-bundle-cell.test.ts';
const CHECK = 'scripts/julius-live-contract-check.mjs';
const EXPORTER = '.github/julius-live-evidence-dump.sh';

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const contractSource = readFileSync(join(MISSION_DIR, 'contract.json'), 'utf8');
const contract = JSON.parse(contractSource) as Record<string, unknown>;

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

/** The paths `slice.txt` names, comments stripped exactly as the provisioner strips them. */
const slicePaths = (): readonly string[] => readFileSync(join(MISSION_DIR, 'slice.txt'), 'utf8')
  .split('\n').map((line) => line.replace(/#.*$/u, '').trim()).filter((line) => line.length > 0);

/* ------------------------------------------------ A. bounds and grants */

describe('the qualification asks for ceilings a deployment granted it, and nobody else gets them', () => {
  it('parses through the live entrypoint and states its own ceilings', () => {
    const parsed = parseLiveMissionContract(contractSource);
    expect(parsed.ok, parsed.ok ? '' : parsed.problem).toBe(true);
    expect(contract.limits).toEqual({ spendUsd: 25, repairCycles: 3, architectMaxOutputTokens: 20_000 });
  });

  const runCheck = (document: unknown): { code: number; output: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-q1-'));
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

  /**
   * THE GRANT IS PER-MISSION, NOT A RAISED DEFAULT. The same document under a
   * namespace nobody granted anything to is refused on all three axes at once —
   * which is the property that keeps one authorised mission from quietly
   * becoming a new floor for every mission after it.
   */
  it('the identical document under an ungranted namespace is refused on spend, repairs AND research', () => {
    const stolen = { ...contract, markerNamespace: 'julius-not-granted-anything' };
    const result = runCheck(stolen);
    expect(result.code).toBe(1);
    expect(result.output).toContain('spendUsd');
    expect(result.output).toContain('repairCycles');
    expect(result.output).toContain('a contract cannot grant itself research authority');
  });

  it('eleven of its twelve criteria block, and the one that cannot be guessed is among them', () => {
    const criteria = contract.acceptanceCriteria as readonly { id: string; blocking: boolean }[];
    expect(criteria).toHaveLength(12);
    expect(criteria.filter((criterion) => criterion.blocking)).toHaveLength(11);
    const established = criteria.find((criterion) => criterion.id === 'criterion-established');
    expect(established, 'the mission is about this criterion').toBeDefined();
    expect(established!.blocking, 'a run may not be scored a success while guessing it').toBe(true);
  });
});

/* ----------------------------------------- B. the question is off-slice */

describe('the one question it turns on is genuinely outside the workspace', () => {
  it('the slice is exactly one file, and it is a tracked file of this repository', () => {
    const paths = slicePaths();
    expect(paths).toEqual([DELIVERABLE]);
    const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', DELIVERABLE], { encoding: 'utf8' }).trim();
    expect(tracked, 'the deliverable must be tracked, or the slice archives nothing').toBe(DELIVERABLE);
  });

  /**
   * THE ANSWER EXISTS AND IS NOT REACHABLE. A question with no answer anywhere
   * would be a trick; a question whose answer sits in the workspace would be a
   * reading exercise. This is neither: the exporter is real, committed, and
   * outside the slice.
   */
  it('the exporter that settles the question is in the repository and NOT in the slice', () => {
    expect(existsSync(join(ROOT, EXPORTER)), 'the authority must exist').toBe(true);
    expect(slicePaths()).not.toContain(EXPORTER);
  });

  /**
   * NOTHING THE CODER CAN READ STATES THE ANSWER.
   *
   * The module doc used to say the bundle was written by `psql -A -F`, which
   * hands over the whole inference: in that mode a NULL and an empty string
   * render alike, so AMBIGUOUS follows without asking anyone. The format is
   * still specified — unquoted, tab-separated — because the module is specified
   * to parse that; what is withheld is how the exporter renders a NULL.
   */
  it('neither the sliced file, the seeded specification nor the contract states how a NULL is rendered', () => {
    const visible = [
      read(DELIVERABLE),
      readFileSync(join(MISSION_DIR, 'seed', SPEC), 'utf8'),
      contractSource,
      readFileSync(join(MISSION_DIR, 'slice.txt'), 'utf8'),
    ].join('\n');
    for (const giveaway of ['psql', 'pset', '-A -F', 'unaligned']) {
      expect(visible.includes(giveaway), `the workspace hands over "${giveaway}"`).toBe(false);
    }
  });

  it('the objective tells the worker to establish the answer rather than decide it', () => {
    const objective = String(contract.objective);
    expect(objective).toContain('CANNOT BE SETTLED FROM THIS WORKSPACE');
    expect(objective).toContain('Do not guess it. Establish it');
  });
});

/* -------------------------------------------- C. the specification bites */

describe('the seeded specification refuses the wrong answers', () => {
  const HARNESS = join(ROOT, '.github/julius-mission-slice');

  /**
   * THE PROVISIONER'S OWN STEPS, minus the parts that need root: archive the
   * slice from a REVISION (never the working tree), lay the loader beside it,
   * then the mission's seed. `implementation` replaces the sliced module, which
   * is what an adversarial reader is.
   */
  const provision = (implementation?: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-q1-run-'));
    scratch.push(dir);
    const rev = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('sh', ['-c', `git -C '${ROOT}' archive --format=tar ${rev} -- ${slicePaths().join(' ')} | tar -x -C '${dir}'`]);
    mkdirSync(join(dir, '.julius'), { recursive: true });
    for (const file of ['resolve.mjs', 'loader.mjs']) cpSync(join(HARNESS, file), join(dir, '.julius', file));
    cpSync(join(MISSION_DIR, 'seed'), dir, { recursive: true });
    if (implementation !== undefined) {
      mkdirSync(dirname(join(dir, DELIVERABLE)), { recursive: true });
      writeFileSync(join(dir, DELIVERABLE), implementation);
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

  /** Case names that FAILED, from TAP, so a case can be named rather than counted. */
  const failedCases = (output: string): readonly string[] =>
    [...output.matchAll(/^not ok \d+ - (.+)$/gmu)].map((match) => match[1]!.trim());
  const passedCases = (output: string): readonly string[] =>
    [...output.matchAll(/^ok \d+ - (.+)$/gmu)].map((match) => match[1]!.trim());

  it('the committed deliverable is a stub: every exported function refuses with one sentinel', () => {
    const source = read(DELIVERABLE);
    const exported = [...source.matchAll(/^export function (\w+)/gmu)].map((match) => match[1]);
    expect(exported.length, 'the deliverable must export the functions to implement').toBeGreaterThan(4);
    expect(source.match(/bundle_cell_not_implemented/gu)?.length).toBe(exported.length);
  });

  it('against the stub the specification FAILS, on its own cases rather than on a load error', () => {
    const result = runSpec(provision());
    expect(result.code, 'a mission whose tests already pass buys nothing').not.toBe(0);
    const failed = failedCases(result.output);
    expect(failed.length, 'the specification must bite the stub broadly').toBeGreaterThan(20);
    expect(result.output, 'it must fail on the stub, not on an import').toContain('bundle_cell_not_implemented');
  }, 60_000);

  /**
   * THE FIRST NATURAL WRONG ANSWER: a reader that answers every cell with what
   * the text says. It is not a broken reader — it returns a well-formed cell
   * every time — and the whole product is the claim that this is wrong.
   */
  const PERMISSIVE = `
export const JULIUS_BUNDLE_CELL_KINDS = ['VALUE', 'UNKNOWN', 'AMBIGUOUS', 'UNREADABLE'];
export const JULIUS_BUNDLE_CELL_VERSION = 'julius-bundle-cell.v1';
const value = (text) => ({ kind: 'VALUE', text });
export function readNumericCell(raw) { return value(raw.trim()); }
export function readTokenCell(raw) { return value(raw.trim()); }
export function readBooleanCell(raw) { return value(raw.trim()); }
export function readTextCell(raw) { return value(raw); }
export function readBundleRow(row, columns) {
  const cells = {};
  for (const column of columns) cells[column.name] = value(row[column.name] ?? '');
  return { version: JULIUS_BUNDLE_CELL_VERSION, cells, unreadable: [], ambiguous: [], scorable: true };
}
export function parseBundleTsv(content) {
  const lines = content.split('\\n').filter((line) => line !== '');
  const header = (lines.shift() ?? '').split('\\t');
  return { header, rows: lines.map((line) => Object.fromEntries(line.split('\\t').map((field, i) => [header[i], field]))), malformed: [] };
}
`;

  /**
   * THE SECOND: a reader that treats absence as the zero of its column. This is
   * the one that would report a run as having spent nothing.
   */
  const ZEROING = PERMISSIVE
    .replace('export function readNumericCell(raw) { return value(raw.trim()); }',
      'export function readNumericCell(raw) { return value(raw.trim() === \'\' ? \'0\' : raw.trim()); }')
    .replace('export function readBooleanCell(raw) { return value(raw.trim()); }',
      'export function readBooleanCell(raw) { return value(raw.trim() === \'\' ? \'false\' : raw.trim()); }');

  const ABSENCE_CASES = [
    'a blank numeric cell is UNKNOWN, because a number is never the empty string',
    'a blank token cell is UNKNOWN, not the vocabulary member that happens to be named UNKNOWN',
    'a blank boolean is UNKNOWN, never false',
    'a blank free-text cell is never silently resolved',
  ];

  it('a reader that resolves every cell to a value is rejected, by the cases about absence', () => {
    const result = runSpec(provision(PERMISSIVE));
    expect(result.code).not.toBe(0);
    const failed = failedCases(result.output);
    for (const name of ABSENCE_CASES) {
      expect(failed, `"${name}" did not discriminate against a permissive reader`).toContain(name);
    }
    // AND IT IS NOT VACUOUS IN THE OTHER DIRECTION: the same reader satisfies
    // the cases about cells that really are values, so the failures above are
    // about absence rather than about the reader being broken.
    expect(passedCases(result.output)).toContain('a numeric cell reads as its value');
    expect(passedCases(result.output)).toContain('free text that is present reads as its value');
  }, 60_000);

  it('a reader that defaults absence to zero and false is rejected, and named', () => {
    const result = runSpec(provision(ZEROING));
    expect(result.code).not.toBe(0);
    const failed = failedCases(result.output);
    expect(failed).toContain('a blank numeric cell is UNKNOWN, because a number is never the empty string');
    expect(failed).toContain('a blank boolean is UNKNOWN, never false');
  }, 60_000);
});

/* ------------------------------------------ D. the research clause fits */

describe('the research clause is the shape of the question and nothing wider', () => {
  const clause = contract.research as {
    roles: readonly string[];
    allowances: readonly { source: string; capabilities: readonly string[]; hosts: readonly string[] }[];
    missionBudget: { maxRetrievals: number; maxBytes: number };
    roleBudget: { maxRetrievals: number; maxBytes: number };
  };

  it('one source, one read capability, one host — and no search', () => {
    expect(clause.allowances).toHaveLength(1);
    expect(clause.allowances[0]!.source).toBe('web');
    expect(clause.allowances[0]!.capabilities).toEqual(['read_item']);
    expect(clause.allowances[0]!.hosts).toHaveLength(1);
    expect(clause.allowances[0]!.capabilities).not.toContain('search');
  });

  /**
   * EVERY SLOT THAT CAN ASK, AND THE LIST IS NOT WRITTEN TWICE.
   *
   * This clause named only the Coding Agent for as long as it was the only
   * slot with a channel to Julius. Both other slots now carry `researchAsks`
   * as a REQUIRED schema field, so both ask on every turn, and a clause that
   * still named one role would refuse the other two `role_not_authorized` —
   * on the one mission whose charter asks the Architect to investigate before
   * the contract locks.
   *
   * PINNED TO `JULIUS_RESEARCH_ROLES`, NOT TO A LITERAL. A literal list is how
   * this diverged the first time: the slots gained a channel and the copy of
   * the list in this fixture did not notice. Adding a fourth slot to the
   * domain now fails here until this mission decides about it, which is the
   * decision being forced rather than a chore.
   */
  it('names every slot the domain has, because every slot can now ask', () => {
    expect([...clause.roles].sort()).toEqual([...JULIUS_RESEARCH_ROLES].sort());
  });

  /**
   * WIDENING THE ROLES BOUGHT NO NEW AUTHORITY. The budget was already three
   * slots' worth, so the same six retrievals are now reachable by three slots
   * instead of one. No host, no capability and no retrieval was added.
   */
  it('the budget was already sized for every slot', () => {
    expect(clause.roleBudget.maxRetrievals * clause.roles.length)
      .toBe(clause.missionBudget.maxRetrievals);
  });

  /**
   * THE BUDGET CANNOT FUND BROWSING. Enough to read a page and check a second;
   * not enough to go looking. A slot that needs more is a slot whose question
   * was not the one this mission is about, and the refusal says so on the
   * record.
   */
  it('the budget is enough to answer one question and not enough to browse', () => {
    expect(clause.roleBudget.maxRetrievals).toBeLessThanOrEqual(2);
    expect(clause.missionBudget.maxRetrievals).toBeLessThanOrEqual(6);
    expect(clause.roleBudget.maxRetrievals).toBeLessThan(clause.missionBudget.maxRetrievals);
    expect(clause.roleBudget.maxBytes).toBeLessThanOrEqual(clause.missionBudget.maxBytes);
  });

  /**
   * THE GRANT IS THE CLAUSE'S EQUAL, NOT ITS SUPERSET.
   *
   * The checker only refuses a clause that EXCEEDS its grant, so a grant wider
   * than the contract is latent authority: widen the contract later and nothing
   * refuses, because the permission was already sitting there. Read the numbers
   * out rather than asking whether the text contains them — `includes('2')`
   * matches the `20` in a raised budget, which is how a widened grant would pass
   * a test that claims to pin it.
   */
  it('the grant in the deployment table is the clause’s equal, not its superset', () => {
    const table = read(CHECK);
    const entry = table.slice(table.indexOf(`'${MISSION}': Object.freeze({`, table.indexOf('const MISSION_RESEARCH')));
    const body = entry.slice(0, entry.indexOf('}),\n});'));
    expect(body).toContain(
      `roles: Object.freeze([${clause.roles.map((role) => `'${role}'`).join(', ')}])`,
    );
    expect(body).toContain(`hosts: Object.freeze(['${clause.allowances[0]!.hosts[0]}'])`);
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
