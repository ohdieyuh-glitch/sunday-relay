import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { juliusBootstrapRunId } from '../relay-bridge/julius/bootstrap';
import { compileBootstrapRequest, parseLiveMissionContract } from '../relay-bridge/julius/mission-contract';

/**
 * DECISION C'S LEARNING PAIR, PINNED BEFORE ANY ARM RUNS (registration design r8.5, section 2 and section 8 item 4).
 *
 * Four mission directories, one namespace, one registration. What makes them ONE experiment is held here, by
 * the production code that will run them:
 *   1. each contract is Mission 5's body with the pair's three ids, byte for byte, and the four differ ONLY
 *      inside their `learningPair` clause; each seed is Mission 5's, byte for byte (founder c1: "Reuse Mission
 *      5's existing mission body");
 *   2. the four run ids, computed through the parse, `compileBootstrapRequest` and `juliusBootstrapRunId` the
 *      bootstrap names each run with, are the ones the registration and the PREREG addendum record: four
 *      distinct runs, and each WITH arm names its own WITHOUT arm's;
 *   3. every arm carries the digest `learning-validate` prints for the committed registration, so the
 *      evaluator's own-record check (evaluate.py, step 4) reads all four arms under this registration and no
 *      other.
 * A changed body, seed, rerun key, run id or registration fails here, before any dispatch: arms that drifted
 * from their registration would be paid runs that measure nothing it promised.
 */

const ROOT = resolve(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const MISSIONS = '.github/julius-missions';
const M5 = `${MISSIONS}/julius-live-mission-5`;
const REGISTRATION = '.github/julius-learning-registrations/julius-learning-pair-1.json';
/** What `learning-validate` printed for the registration, without its `sha256:` prefix: the form a clause carries. */
const REGISTRATION_DIGEST = '4ebb010e2c04b08f129c9c1590d062be11900905f0cb9f22bd6bcb1f8198a62f';
const IDENTITY = { missionId: 'mission:julius-learning-pair-1', markerNamespace: 'julius-learning-pair-1', projectId: 'prj-julius-learning-pair-1' };
const POLICY = { dimensions: ['repairs'], minimumRelativeImprovement: 0.5, minimumImprovedDimensions: 1 };
/** The four arm runs, derived before any of them ran (section 2) and registered before arm 1 (section 4, V5 E1(a)). */
const RUN_IDS = {
  'jlp1-without-1': 'run:e50d275a63daa1dc3bc92a2a',
  'jlp1-with-1': 'run:d9991fd5c259ef434de1011d',
  'jlp1-without-2': 'run:b009e3e39c4d80d607dbaf5d',
  'jlp1-with-2': 'run:fefae24f8c8aab71f2920433',
} as const;
type RerunKey = keyof typeof RUN_IDS;
/** In the order they are dispatched (section 5, E6). */
const ARMS: readonly { readonly dir: string; readonly arm: 'WITHOUT' | 'WITH'; readonly rerunKey: RerunKey; readonly without?: RerunKey }[] = [
  { dir: 'julius-learning-pair-1-without-1', arm: 'WITHOUT', rerunKey: 'jlp1-without-1' },
  { dir: 'julius-learning-pair-1-with-1', arm: 'WITH', rerunKey: 'jlp1-with-1', without: 'jlp1-without-1' },
  { dir: 'julius-learning-pair-1-without-2', arm: 'WITHOUT', rerunKey: 'jlp1-without-2' },
  { dir: 'julius-learning-pair-1-with-2', arm: 'WITH', rerunKey: 'jlp1-with-2', without: 'jlp1-without-2' },
];

/** Where the clause begins in a contract the generator wrote: after the body's last field, before the closing brace. */
const CLAUSE_START = ',\n  "learningPair": ';
const contractText = (dir: string): string => read(`${MISSIONS}/${dir}/contract.json`);

/** Mission 5's contract text with the pair's three ids in place of its own: the shared body, before any clause. */
const bodyText = (): string => {
  const m5Text = read(`${M5}/contract.json`);
  const m5 = JSON.parse(m5Text) as Record<string, unknown>;
  let text = m5Text;
  for (const [field, value] of Object.entries(IDENTITY)) {
    const from = `"${field}": ${JSON.stringify(m5[field])}`;
    expect(text.split(from).length - 1, `Mission 5's contract names its ${field} exactly once`).toBe(1);
    text = text.replace(from, `"${field}": ${JSON.stringify(value)}`);
  }
  return text;
};

const compiled = (text: string) => {
  const parsed = parseLiveMissionContract(text);
  if (!parsed.ok) throw new Error(`the contract is refused: ${parsed.problem}`);
  // Neither the workers nor the card revision enter the binding: the run's identity is the contract's.
  return compileBootstrapRequest(parsed.contract, [], 'card:julius-live:1');
};

/** Every file under a directory, relative to it, `/`-separated. */
const filesUnder = (relative: string): string[] => {
  const files: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${directory}/${entry.name}`, `${prefix}${entry.name}/`);
      else files.push(`${prefix}${entry.name}`);
    }
  };
  walk(relative, '');
  return files.sort();
};

const python = ['python3', 'python'].find((candidate) =>
  spawnSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 10)'], { encoding: 'utf8' }).status === 0);

describe('the pair is four arms of one namespace, and no more', () => {
  it('exactly the four registered arm directories carry the namespace', () => {
    const carrying = readdirSync(join(ROOT, MISSIONS), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => (JSON.parse(contractText(entry.name)) as { markerNamespace?: unknown }).markerNamespace === IDENTITY.markerNamespace)
      .map((entry) => entry.name);
    expect(carrying.sort(), 'no extra arm, and none missing (founder c2: all four arms, nothing beyond them)')
      .toEqual(ARMS.map((arm) => arm.dir).sort());
  });

  it('each arm directory holds its contract and its seed, nothing else', () => {
    for (const arm of ARMS) expect(readdirSync(join(ROOT, MISSIONS, arm.dir)).sort(), arm.dir).toEqual(['contract.json', 'workspace']);
  });
});

describe("the bodies are Mission 5's and equal, the clauses are the only difference, and the seeds are Mission 5's", () => {
  it("each contract is Mission 5's body with the pair's ids, byte for byte, up to its clause", () => {
    const body = bodyText();
    for (const arm of ARMS) {
      const text = contractText(arm.dir);
      expect(text.includes('\r'), `${arm.dir}: LF only`).toBe(false);
      const cut = text.indexOf(CLAUSE_START);
      expect(cut, `${arm.dir}: the clause follows the body`).toBeGreaterThan(0);
      expect(text.lastIndexOf(CLAUSE_START), `${arm.dir}: one clause`).toBe(cut);
      expect(`${text.slice(0, cut)}\n}\n`, `${arm.dir}: everything outside the clause is the shared body`).toBe(body);
    }
  });

  it("each clause is its arm's and nothing else: one registration, its own rerun key, its WITHOUT arm's run, one policy", () => {
    const rerunKeys = new Set<string>();
    for (const arm of ARMS) {
      const contract = JSON.parse(contractText(arm.dir)) as { learningPair: Record<string, unknown> };
      const expected = {
        registrationDigest: REGISTRATION_DIGEST, arm: arm.arm, rerunKey: arm.rerunKey,
        ...(arm.without === undefined ? {} : { withoutRunId: RUN_IDS[arm.without] }),
        policy: POLICY,
      };
      expect(contract.learningPair, arm.dir).toEqual(expected);
      expect(Object.keys(contract.learningPair), `${arm.dir}: the clause's fields, in order`).toEqual(Object.keys(expected));
      rerunKeys.add(contract.learningPair.rerunKey as string);
    }
    expect(rerunKeys.size, 'four arms, four rerun keys: the rerun key alone names an arm\'s run').toBe(4);
  });

  it("each seed is Mission 5's, file for file and byte for byte", () => {
    const seed = filesUnder(`${M5}/workspace`);
    expect(seed.length, 'Mission 5 seeds something').toBeGreaterThan(0);
    for (const arm of ARMS) {
      expect(filesUnder(`${MISSIONS}/${arm.dir}/workspace`), arm.dir).toEqual(seed);
      for (const file of seed) {
        const ours = readFileSync(join(ROOT, MISSIONS, arm.dir, 'workspace', file));
        expect(ours.equals(readFileSync(join(ROOT, M5, 'workspace', file))), `${arm.dir}/workspace/${file}`).toBe(true);
      }
    }
  });
});

describe('the four run ids, by the derivation the bootstrap runs', () => {
  it('compileBootstrapRequest + juliusBootstrapRunId name each arm its registered run, one objective for all four', () => {
    const plain = compiled(bodyText());
    const computed = new Map<RerunKey, string>();
    for (const arm of ARMS) {
      const request = compiled(contractText(arm.dir));
      expect(request.missionBindingDigest, `${arm.dir}: the clause stays outside the binding`).toBe(plain.missionBindingDigest);
      expect(request.idempotencyKey, arm.dir).toBe(plain.idempotencyKey);
      expect([request.rerunIntent, request.rerunKey], `${arm.dir}: an explicit rerun under its own key`).toEqual(['EXPLICIT', arm.rerunKey]);
      computed.set(arm.rerunKey, juliusBootstrapRunId(request));
    }
    expect(Object.fromEntries(computed), 'the run ids the registration and the PREREG addendum record').toEqual(RUN_IDS);
    expect(new Set(computed.values()).size, 'four distinct runs: WITHOUT-1 != WITHOUT-2, WITH-1 != WITH-2').toBe(4);
    expect([...computed.values()], 'no arm is the plain contract\'s run, served as its replay').not.toContain(juliusBootstrapRunId(plain));
    expect(plain.missionBindingDigest, 'the shared body\'s binding').toBe('sha256:6148c551c9fbaf79e85eaca6906fe5ce59afeb71e054dff6ba0955e472532774');
  });

  it("each WITH arm names its own WITHOUT arm's run, and the registration's baselines are the two WITHOUT runs", () => {
    for (const arm of ARMS.filter((entry) => entry.arm === 'WITH')) {
      const without = ARMS.find((entry) => entry.rerunKey === arm.without);
      expect(without?.arm, `${arm.dir} names a WITHOUT arm`).toBe('WITHOUT');
      const contract = JSON.parse(contractText(arm.dir)) as { learningPair: { withoutRunId?: string } };
      const withoutRun = juliusBootstrapRunId(compiled(contractText(without!.dir)));
      expect(contract.learningPair.withoutRunId, arm.dir).toBe(withoutRun);
    }
    const registration = JSON.parse(read(REGISTRATION)) as { baselineRuns: string[]; adaptation: { changeRef: string } };
    expect(registration.baselineRuns).toEqual([RUN_IDS['jlp1-without-1'], RUN_IDS['jlp1-without-2']]);
    expect(registration.adaptation.changeRef).toContain(`WITHOUT run ids ${RUN_IDS['jlp1-without-1']}, ${RUN_IDS['jlp1-without-2']}`);
  });
});

describe('the registration, and the digest every arm carries', () => {
  it('a Python >= 3.10 is on the runner (absence fails, it is never skipped)', () => {
    expect(python, 'python3 or python >= 3.10 must be on PATH: learning-validate is the digest\'s only authority').toBeDefined();
  });

  it('learning-validate accepts the committed registration, and its digest is the one all four clauses carry', () => {
    expect(python).toBeDefined();
    const result = spawnSync(python!, ['-B', '-m', 'julius_brain_intel', 'learning-validate', join(ROOT, REGISTRATION)], {
      cwd: join(ROOT, 'python'), encoding: 'utf8', timeout: 60_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ registrationId: 'julius-learning-pair-1', digest: `sha256:${REGISTRATION_DIGEST}`, valid: true });
    for (const arm of ARMS) {
      const contract = JSON.parse(contractText(arm.dir)) as { learningPair: { registrationDigest: string } };
      expect(contract.learningPair.registrationDigest, arm.dir).toBe(REGISTRATION_DIGEST);
    }
  }, 60_000);

  it('names no commit and no PR inside the digest, and passes the safety screen (section 3)', () => {
    const text = read(REGISTRATION);
    const registration = JSON.parse(text) as { adaptation: { changeRef: string } };
    // [r7-1]: the arms carry the digest, so a commit named inside it would be circular. The commit is recorded outside it.
    expect(registration.adaptation.changeRef).not.toMatch(/\b[0-9a-f]{40}\b|#\d+/u);
    expect(text, 'no reasoning-shaped words').not.toMatch(/chain[- ]of[- ]thought|hidden reasoning|<thinking>|internal monologue/iu);
    const m5 = JSON.parse(read(`${M5}/contract.json`)) as { objective: string; requirements: string[]; constraints: string[] };
    for (const sentence of [m5.objective, ...m5.requirements, ...m5.constraints]) {
      expect(text.includes(sentence.slice(0, 48)), `no mission text is quoted: ${sentence.slice(0, 48)}`).toBe(false);
    }
  });
});
