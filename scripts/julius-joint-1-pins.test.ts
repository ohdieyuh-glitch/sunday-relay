import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { juliusBootstrapRunId } from '../relay-bridge/julius/bootstrap';
import { compileBootstrapRequest, parseLiveMissionContract } from '../relay-bridge/julius/mission-contract';

/**
 * JOINT-1 (Decision C registration 3, the four shared P6 Unreal runs): THE MISSION DIRECTORIES, DRAFT, UNFROZEN.
 * Design: JOINT1_REGISTRATION_DESIGN_DRAFT_r1.md section 3 (the same machinery as `julius-learning-pair-2-pins.test.ts`).
 *
 * What this file holds, by the production code that will run the arms:
 *   1. the four contracts are equal up to their `learningPair` clause, and the four seeds (workspace/ and dryrun/, the static test
 *      inside workspace/) are equal file for file and byte for byte;
 *   2. the ids are the joint-1 ids and DIFFER from julius-unreal-mission-2's (Q7: a plain mission-2 beside the arms is refused);
 *   3. the four rerun keys are `jj1-*`, distinct from `jlp1-*` / `jlp2-*`; the four run ids come from the production derivation
 *      (never typed here), are distinct, and each WITH arm names its own WITHOUT arm's run;
 *   4. the clause fields, in order, with ONE registration digest on all four.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO (nothing is frozen, nothing is hash-registered):
 *   - it pins NO body sha256, NO run id, NO tree id and NO registration digest: those are written by the freeze, after REVIEW.
 *     `FREEZE` below holds them as `null`, and the last test fails the day one is filled in without the placeholder being retired.
 *   - the digest in the arms is the all-zero PLACEHOLDER. Replace it with `learning-validate`'s output only at the freeze.
 */

const ROOT = resolve(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

const MISSIONS = '.github/julius-missions';
const IDENTITY = { missionId: 'mission:julius-joint-1', markerNamespace: 'julius-joint-1', projectId: 'prj-julius-joint-1' };
/** julius-unreal-mission-2's ids (branch m2-remerge-5004713, contract.json): joint-1's must differ from every one of them. */
const MISSION_2_IDENTITY = { missionId: 'mission:julius-unreal-2', markerNamespace: 'julius-unreal-mission-2', projectId: 'prj-julius-unreal-2' };
/** PLACEHOLDER: not a registration's digest. OPEN (design Q3/Q11): replaced by `learning-validate`'s digest at the freeze. */
const PLACEHOLDER_DIGEST = '0'.repeat(64);
/** OPEN (design Q-registration, Q4): policy copied from registrations 1 and 2; the founder/REVIEW may change it before the freeze. */
const POLICY = { dimensions: ['repairs'], minimumRelativeImprovement: 0.5, minimumImprovedDimensions: 1 };
/** Written by the freeze only. All null = UNFROZEN. */
const FREEZE: { bodySha256: string | null; registrationDigest: string | null; runIds: null | Record<string, string>; treeIds: null | Record<string, string> } =
  { bodySha256: null, registrationDigest: null, runIds: null, treeIds: null };

type RerunKey = 'jj1-without-1' | 'jj1-with-1' | 'jj1-without-2' | 'jj1-with-2';
/** In the order the arms are defined. The DISPATCH order is OPEN (design Q4: W1,H1,W2,H2 vs W1,W2,H1,H2). */
const ARMS: readonly { readonly dir: string; readonly arm: 'WITHOUT' | 'WITH'; readonly rerunKey: RerunKey; readonly without?: RerunKey }[] = [
  { dir: 'julius-joint-1-without-1', arm: 'WITHOUT', rerunKey: 'jj1-without-1' },
  { dir: 'julius-joint-1-with-1', arm: 'WITH', rerunKey: 'jj1-with-1', without: 'jj1-without-1' },
  { dir: 'julius-joint-1-without-2', arm: 'WITHOUT', rerunKey: 'jj1-without-2' },
  { dir: 'julius-joint-1-with-2', arm: 'WITH', rerunKey: 'jj1-with-2', without: 'jj1-without-2' },
];

/** Where the clause begins in a contract the generator wrote: after the body's last field, before the closing brace. */
const CLAUSE_START = ',\n  "learningPair": ';
const contractText = (dir: string): string => read(`${MISSIONS}/${dir}/contract.json`);
const bodyOf = (text: string): string => `${text.slice(0, text.indexOf(CLAUSE_START))}\n}\n`;

const compiled = (text: string) => {
  const parsed = parseLiveMissionContract(text);
  if (!parsed.ok) throw new Error(`the contract is refused: ${parsed.problem}`);
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

describe('joint-1 is four arms of one namespace, and no more', () => {
  it('exactly the four arm directories carry the namespace, and nothing carries mission 2\'s ids', () => {
    const contracts = readdirSync(join(ROOT, MISSIONS), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ dir: entry.name, parsed: JSON.parse(contractText(entry.name)) as Record<string, unknown> }));
    expect(contracts.filter((c) => c.parsed.markerNamespace === IDENTITY.markerNamespace).map((c) => c.dir).sort(), 'no extra arm, none missing')
      .toEqual(ARMS.map((arm) => arm.dir).sort());
    for (const field of Object.keys(IDENTITY) as (keyof typeof IDENTITY)[]) {
      expect(contracts.filter((c) => c.parsed[field] === IDENTITY[field]).map((c) => c.dir).sort(), `${field}: the four arms and only them`)
        .toEqual(ARMS.map((arm) => arm.dir).sort());
      expect(IDENTITY[field], `${field} differs from julius-unreal-mission-2's`).not.toBe(MISSION_2_IDENTITY[field]);
      expect(contracts.filter((c) => c.parsed[field] === MISSION_2_IDENTITY[field]), `${field}: no directory is on mission 2's id`).toEqual([]);
    }
    expect(IDENTITY.markerNamespace).toMatch(/^[a-z][a-z0-9-]{2,48}$/u);
  });

  it('each arm directory holds its contract, its dry run and its seed, nothing else', () => {
    for (const arm of ARMS) expect(readdirSync(join(ROOT, MISSIONS, arm.dir)).sort(), arm.dir).toEqual(['contract.json', 'dryrun', 'workspace']);
  });
});

describe('the bodies are equal, the clauses are the only difference, and the seeds are equal', () => {
  it('each contract is one shared body with the joint-1 ids, byte for byte, up to its clause', () => {
    const bodies = new Set<string>();
    for (const arm of ARMS) {
      const text = contractText(arm.dir);
      expect(text.includes('\r'), `${arm.dir}: LF only`).toBe(false);
      const cut = text.indexOf(CLAUSE_START);
      expect(cut, `${arm.dir}: the clause follows the body`).toBeGreaterThan(0);
      expect(text.lastIndexOf(CLAUSE_START), `${arm.dir}: one clause`).toBe(cut);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      for (const [field, value] of Object.entries(IDENTITY)) expect(parsed[field], `${arm.dir}: ${field}`).toBe(value);
      expect(parsed.limits, `${arm.dir}: limits as mission 2 ($30, 3 cycles, 20000 architect tokens)`).toEqual({ spendUsd: 30, repairCycles: 3, architectMaxOutputTokens: 20000 });
      bodies.add(bodyOf(text));
    }
    expect(bodies.size, 'the four bodies are one body').toBe(1);
    if (FREEZE.bodySha256 !== null) expect(sha256([...bodies][0]!), 'the frozen body').toBe(FREEZE.bodySha256);
  });

  it("each clause is its arm's and nothing else: one digest, its own rerun key, its WITHOUT arm's run, one policy", () => {
    const rerunKeys = new Set<string>();
    const digests = new Set<string>();
    for (const arm of ARMS) {
      const contract = JSON.parse(contractText(arm.dir)) as { learningPair: Record<string, unknown> };
      const clause = contract.learningPair;
      const expectedKeys = ['registrationDigest', 'arm', 'rerunKey', ...(arm.without === undefined ? [] : ['withoutRunId']), 'policy'];
      expect(Object.keys(clause), `${arm.dir}: the clause's fields, in order`).toEqual(expectedKeys);
      expect(clause.arm, arm.dir).toBe(arm.arm);
      expect(clause.rerunKey, arm.dir).toBe(arm.rerunKey);
      expect(clause.policy, arm.dir).toEqual(POLICY);
      rerunKeys.add(clause.rerunKey as string);
      digests.add(clause.registrationDigest as string);
    }
    expect(rerunKeys.size, "four arms, four rerun keys: the rerun key alone names an arm's run").toBe(4);
    for (const key of rerunKeys) expect(key, 'jj1-*, distinct from jlp1-* and jlp2-*').toMatch(/^jj1-(with|without)-[12]$/u);
    expect(digests.size, 'ONE registration digest on all four').toBe(1);
    expect([...digests][0], 'a placeholder until the freeze, or the frozen digest').toBe(FREEZE.registrationDigest ?? PLACEHOLDER_DIGEST);
  });

  it('the four seeds (workspace/ and dryrun/) are equal file for file and byte for byte', () => {
    const first = ARMS[0]!;
    for (const part of ['workspace', 'dryrun']) {
      const seed = filesUnder(`${MISSIONS}/${first.dir}/${part}`);
      expect(seed.length, `${part} holds files`).toBeGreaterThan(0);
      for (const arm of ARMS) {
        expect(filesUnder(`${MISSIONS}/${arm.dir}/${part}`), `${arm.dir}/${part}`).toEqual(seed);
        for (const file of seed) {
          const ours = readFileSync(join(ROOT, MISSIONS, arm.dir, part, file));
          expect(ours.equals(readFileSync(join(ROOT, MISSIONS, first.dir, part, file))), `${arm.dir}/${part}/${file}`).toBe(true);
        }
      }
    }
    expect(filesUnder(`${MISSIONS}/${first.dir}/workspace`), 'the declared static test is in the seed').toContain('.julius/hub-scroll-static.test.mjs');
  });
});

describe('the four run ids, by the derivation the bootstrap runs', () => {
  it('compileBootstrapRequest + juliusBootstrapRunId name four distinct runs, the clause outside the binding, one objective for all four', () => {
    const plain = compiled(bodyOf(contractText(ARMS[0]!.dir)));
    const computed = new Map<RerunKey, string>();
    for (const arm of ARMS) {
      const request = compiled(contractText(arm.dir));
      expect(request.missionBindingDigest, `${arm.dir}: the clause stays outside the binding`).toBe(plain.missionBindingDigest);
      expect(request.idempotencyKey, arm.dir).toBe(plain.idempotencyKey);
      expect([request.rerunIntent, request.rerunKey], `${arm.dir}: an explicit rerun under its own key`).toEqual(['EXPLICIT', arm.rerunKey]);
      computed.set(arm.rerunKey, juliusBootstrapRunId(request));
    }
    expect(new Set(computed.values()).size, 'four distinct runs').toBe(4);
    expect([...computed.values()], "no arm is the plain contract's run, served as its replay").not.toContain(juliusBootstrapRunId(plain));
    if (FREEZE.runIds !== null) expect(Object.fromEntries(computed), 'the frozen run ids').toEqual(FREEZE.runIds);
  });

  it("each WITH arm names its own WITHOUT arm's run (computed, not typed)", () => {
    for (const arm of ARMS.filter((entry) => entry.arm === 'WITH')) {
      const without = ARMS.find((entry) => entry.rerunKey === arm.without);
      expect(without?.arm, `${arm.dir} names a WITHOUT arm`).toBe('WITHOUT');
      const contract = JSON.parse(contractText(arm.dir)) as { learningPair: { withoutRunId?: string } };
      expect(contract.learningPair.withoutRunId, arm.dir).toBe(juliusBootstrapRunId(compiled(contractText(without!.dir))));
    }
  });
});

describe('the pins and the limits are in place, and the registration is still UNFROZEN', () => {
  it('the pins file lists each arm directory once (a throwaway tree: its directory is its one pin)', () => {
    const lines = read('.github/julius-mission-pins.txt').split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));
    for (const arm of ARMS) {
      const mine = lines.filter((line) => line.split(' ')[0] === arm.dir);
      expect(mine.length, arm.dir).toBe(1);
      expect(mine[0]!.split(' ')[1], arm.dir).toBe(`${MISSIONS}/${arm.dir}`);
    }
  });

  it('MISSION_LIMITS has ONE entry for the namespace: $30, 3 cycles (design 3.8); no lane entry (the default lab)', () => {
    const source = read('scripts/julius-live-contract-check.mjs');
    expect(source.match(/'julius-joint-1': Object\.freeze\(\{ spendUsd: 30, repairCycles: 3 \}\)/gu)?.length).toBe(1);
    expect(source.match(/'julius-joint-1'/gu)?.length, 'the namespace appears once in the file: no MISSION_LANES entry').toBe(1);
  });

  it('nothing is frozen: no digest, tree id, run id or body sha256 is pinned here yet', () => {
    expect(FREEZE).toEqual({ bodySha256: null, registrationDigest: null, runIds: null, treeIds: null });
  });
});
