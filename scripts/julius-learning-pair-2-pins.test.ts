import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compileBootstrapRequest, parseLiveMissionContract } from '../relay-bridge/julius/mission-contract';
import { parseJuliusAdmissionRunId } from './julius-admission-run-id.mjs';

/**
 * DECISION C, REGISTRATION 2, PINNED BEFORE ANY ARM RUNS (design r9, section S1; the same machinery as registration 1's
 * `julius-learning-pair-pins.test.ts`, for its own namespace).
 *
 * Four mission directories, one namespace, one registration. What makes them ONE experiment is held here, by the production
 * code that will run them:
 *   1. the four contracts are equal up to their `learningPair` clause (the shared body is pinned by its sha256) and the four
 *      seeds are equal file for file and byte for byte, with the specification file pinned by its sha256;
 *   2. the four run ids the registration records are what the contracts contain, and the shared admission parser reads
 *      each as a legacy reference: four distinct runs, each WITH arm naming its own WITHOUT arm's;
 *   3. every arm carries the digest `learning-validate` prints for the committed registration.
 * A changed body, seed, rerun key, run id or registration fails here, before any dispatch.
 */

const ROOT = resolve(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

const MISSIONS = '.github/julius-missions';
const REGISTRATION = '.github/julius-learning-registrations/julius-learning-pair-2.json';
/** What `learning-validate` printed for the registration, without its `sha256:` prefix: the form a clause carries. */
const REGISTRATION_DIGEST = '50b7a85740182611ef407b04a7dab0512fd8b9413ac67c2fb8d75bf0218abe4e';
const IDENTITY = { missionId: 'mission:julius-learning-pair-2', markerNamespace: 'julius-learning-pair-2', projectId: 'prj-julius-learning-pair-2' };
const POLICY = { dimensions: ['repairs'], minimumRelativeImprovement: 0.5, minimumImprovedDimensions: 1 };
/** The shared contract body (the text before the clause, with the closing brace), pinned: design r9 section S1 records this sha256. */
const BODY_SHA256 = 'f8a9913f40d4bef315023a1d173e30dd72715ffdc29e9de56e77c655e568e378';
const BINDING_DIGEST = 'sha256:0ebe60c6575b4806eb9874b86cb98f332eb73fef26ddc7b0ecacc70bb54103ab';
const SPEC = 'workspace/src/relay/mission/julius/julius-accept-review-gate.hold-binding.test.ts';
const SPEC_SHA256 = 'da4e36285b2481563ff933a1ba593b7260af0435d0af46eec42ce17cbcfe5e2f';
/** The four arm runs, derived before any of them ran and registered before arm 1. */
const RUN_IDS = {
  'jlp2-without-1': 'run:7ca9e3e35e07cc1a487eed6b',
  'jlp2-with-1': 'run:ac9f6d63ce7b972d44149b72',
  'jlp2-without-2': 'run:ca798f52c7b6d2b7f8bf2149',
  'jlp2-with-2': 'run:2d3289edf88b5e0a1bcea25d',
} as const;
type RerunKey = keyof typeof RUN_IDS;
/** In the order the arms are defined; the DISPATCH order is WITHOUT-1, WITHOUT-2, WITH-1, WITH-2 (design r9, section S2). */
const ARMS: readonly { readonly dir: string; readonly arm: 'WITHOUT' | 'WITH'; readonly rerunKey: RerunKey; readonly without?: RerunKey }[] = [
  { dir: 'julius-learning-pair-2-without-1', arm: 'WITHOUT', rerunKey: 'jlp2-without-1' },
  { dir: 'julius-learning-pair-2-with-1', arm: 'WITH', rerunKey: 'jlp2-with-1', without: 'jlp2-without-1' },
  { dir: 'julius-learning-pair-2-without-2', arm: 'WITHOUT', rerunKey: 'jlp2-without-2' },
  { dir: 'julius-learning-pair-2-with-2', arm: 'WITH', rerunKey: 'jlp2-with-2', without: 'jlp2-without-2' },
];

/** Where the clause begins in a contract the generator wrote: after the body's last field, before the closing brace. */
const CLAUSE_START = ',\n  "learningPair": ';
const contractText = (dir: string): string => read(`${MISSIONS}/${dir}/contract.json`);
const bodyOf = (text: string): string => `${text.slice(0, text.indexOf(CLAUSE_START))}\n}\n`;

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

describe('registration 2 is four arms of one namespace, and no more', () => {
  it('exactly the four registered arm directories carry the namespace', () => {
    const carrying = readdirSync(join(ROOT, MISSIONS), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => (JSON.parse(contractText(entry.name)) as { markerNamespace?: unknown }).markerNamespace === IDENTITY.markerNamespace)
      .map((entry) => entry.name);
    expect(carrying.sort(), 'no extra arm, and none missing').toEqual(ARMS.map((arm) => arm.dir).sort());
  });

  it('each arm directory holds its contract and its seed, nothing else', () => {
    for (const arm of ARMS) expect(readdirSync(join(ROOT, MISSIONS, arm.dir)).sort(), arm.dir).toEqual(['contract.json', 'workspace']);
  });
});

describe('the bodies are equal, the clauses are the only difference, and the seeds are equal', () => {
  it('each contract is the shared body (pinned by sha256) with the pair\'s ids, byte for byte, up to its clause', () => {
    const bodies = new Set<string>();
    for (const arm of ARMS) {
      const text = contractText(arm.dir);
      expect(text.includes('\r'), `${arm.dir}: LF only`).toBe(false);
      const cut = text.indexOf(CLAUSE_START);
      expect(cut, `${arm.dir}: the clause follows the body`).toBeGreaterThan(0);
      expect(text.lastIndexOf(CLAUSE_START), `${arm.dir}: one clause`).toBe(cut);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      for (const [field, value] of Object.entries(IDENTITY)) expect(parsed[field], `${arm.dir}: ${field}`).toBe(value);
      bodies.add(bodyOf(text));
    }
    expect(bodies.size, 'the four bodies are one body').toBe(1);
    expect(sha256([...bodies][0]!), 'the shared body is the one design r9 records').toBe(BODY_SHA256);
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

  it('the four seeds are equal file for file and byte for byte, and the specification is the pinned file', () => {
    const first = ARMS[0]!;
    const seed = filesUnder(`${MISSIONS}/${first.dir}/workspace`);
    expect(seed.length, 'the seed holds files').toBeGreaterThan(0);
    for (const arm of ARMS) {
      expect(filesUnder(`${MISSIONS}/${arm.dir}/workspace`), arm.dir).toEqual(seed);
      for (const file of seed) {
        const ours = readFileSync(join(ROOT, MISSIONS, arm.dir, 'workspace', file));
        expect(ours.equals(readFileSync(join(ROOT, MISSIONS, first.dir, 'workspace', file))), `${arm.dir}/workspace/${file}`).toBe(true);
      }
      expect(sha256(readFileSync(join(ROOT, MISSIONS, arm.dir, SPEC))), `${arm.dir}: the specification`).toBe(SPEC_SHA256);
    }
  });
});

describe('the four recorded run ids stay legacy references the shared parser accepts', () => {
  it('each arm keeps one objective, and its registered run id parses as a legacy reference', () => {
    const plain = compiled(bodyOf(contractText(ARMS[0]!.dir)));
    const bootstrap = read(join('relay-bridge', 'julius', 'bootstrap.ts'));
    expect(bootstrap).not.toContain('juliusBootstrapRunId');
    expect(bootstrap).not.toContain('`run:${identity}`');
    for (const arm of ARMS) {
      const request = compiled(contractText(arm.dir));
      expect(request.missionBindingDigest, `${arm.dir}: the clause stays outside the binding`).toBe(plain.missionBindingDigest);
      expect(request.idempotencyKey, arm.dir).toBe(plain.idempotencyKey);
      expect([request.rerunIntent, request.rerunKey], `${arm.dir}: an explicit rerun under its own key`).toEqual(['EXPLICIT', arm.rerunKey]);
      const recorded = RUN_IDS[arm.rerunKey];
      expect(parseJuliusAdmissionRunId(recorded), arm.dir).toEqual({ ok: true, form: 'legacy', runId: recorded });
    }
    expect(new Set(Object.values(RUN_IDS)).size, 'four distinct runs: WITHOUT-1 != WITHOUT-2, WITH-1 != WITH-2').toBe(4);
    expect(plain.missionBindingDigest, 'the shared body\'s binding').toBe(BINDING_DIGEST);
  });

  it("each WITH arm names its own WITHOUT arm's run, and the registration's baselines are the two WITHOUT runs", () => {
    for (const arm of ARMS.filter((entry) => entry.arm === 'WITH')) {
      const without = ARMS.find((entry) => entry.rerunKey === arm.without);
      expect(without?.arm, `${arm.dir} names a WITHOUT arm`).toBe('WITHOUT');
      const contract = JSON.parse(contractText(arm.dir)) as { learningPair: { withoutRunId?: string } };
      const withoutRun = RUN_IDS[arm.without!];
      expect(contract.learningPair.withoutRunId, arm.dir).toBe(withoutRun);
      expect(parseJuliusAdmissionRunId(withoutRun), arm.dir).toEqual({ ok: true, form: 'legacy', runId: withoutRun });
    }
    const registration = JSON.parse(read(REGISTRATION)) as { baselineRuns: string[]; adaptation: { changeRef: string } };
    expect(registration.baselineRuns).toEqual([RUN_IDS['jlp2-without-1'], RUN_IDS['jlp2-without-2']]);
    expect(registration.adaptation.changeRef).toContain(`WITHOUT run ids ${RUN_IDS['jlp2-without-1']}, ${RUN_IDS['jlp2-without-2']}`);
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
    expect(JSON.parse(result.stdout)).toEqual({ registrationId: 'julius-learning-pair-2', digest: `sha256:${REGISTRATION_DIGEST}`, valid: true });
    for (const arm of ARMS) {
      const contract = JSON.parse(contractText(arm.dir)) as { learningPair: { registrationDigest: string } };
      expect(contract.learningPair.registrationDigest, arm.dir).toBe(REGISTRATION_DIGEST);
    }
  }, 60_000);

  it('names no commit and no PR inside the digest, and passes the safety screen', () => {
    const text = read(REGISTRATION);
    const registration = JSON.parse(text) as { adaptation: { changeRef: string } };
    // The arms carry the digest, so a commit named inside it would be circular. The commit is recorded outside it.
    expect(registration.adaptation.changeRef).not.toMatch(/\b[0-9a-f]{40}\b|#\d+/u);
    expect(text, 'no reasoning-shaped words').not.toMatch(/chain[- ]of[- ]thought|hidden reasoning|<thinking>|internal monologue/iu);
    const body = JSON.parse(contractText(ARMS[0]!.dir)) as { objective: string; requirements: string[]; constraints: string[] };
    for (const sentence of [body.objective, ...body.requirements, ...body.constraints]) {
      expect(text.includes(sentence.slice(0, 48)), `no mission text is quoted: ${sentence.slice(0, 48)}`).toBe(false);
    }
  });
});
