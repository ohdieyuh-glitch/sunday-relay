import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JULIUS_CHALLENGE_CATEGORIES } from '../../src/relay/mission/julius/julius-continuous-lifecycle';
import { liveVerificationOptions } from '../julius-live-mission';
import { compileBootstrapRequest, parseLiveMissionContract } from './mission-contract';

/**
 * DECISION C, OPTION B: A CONTRACT MAY NAME THE KINDS OF WARNING IT WILL NOT LET PASS.
 *
 * `promotedWarningCategories` existed on the verification policy and nothing
 * could reach it: no contract field, no composition wiring, and a contract that
 * wrote the key anyway was silently parsed without it. These cases hold the
 * contract half: a closed list, refused rather than dropped when wrong, part of
 * the mission's identity when present, and ABSENT FROM EVERY MISSION TODAY, so
 * no frozen mission's identity moves.
 */

const ROOT = resolve(process.cwd());
const BASE = {
  missionId: 'mission:c-without-b', markerNamespace: 'c-without-b', projectId: 'prj-c', tenantId: 'tenant-c',
  objective: 'Make the save-file loader refuse a header whose byte order it cannot read.',
  requirements: ['A big-endian header is refused with a clear error.'], constraints: ['Touch only src/save/.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The loader refuses what it cannot read.', blocking: true }],
  testCommand: '', workspacePath: '/workspace/c-without-b', limits: { spendUsd: 2, repairCycles: 2 }, carryArm: 'WITHOUT',
};
const parse = (fields: Record<string, unknown>) => parseLiveMissionContract(JSON.stringify({ ...BASE, ...fields }));
const digestOf = (fields: Record<string, unknown>): string => {
  const parsed = parse(fields);
  if (!parsed.ok) throw new Error(parsed.problem);
  return compileBootstrapRequest(parsed.contract, [], 'card').missionBindingDigest;
};
const REFUSAL = `The contract field "promotedWarningCategories" must be a non-empty list of distinct review categories, each one of: ${JULIUS_CHALLENGE_CATEGORIES.join(', ')}.`;

describe('the contract field', () => {
  it('accepts kinds from Julius\'s own list, in the order written', () => {
    const parsed = parse({ promotedWarningCategories: ['missed_acceptance_criterion', 'contract_drift'] });
    expect(parsed.ok && parsed.contract.promotedWarningCategories).toEqual(['missed_acceptance_criterion', 'contract_drift']);
    const every = parse({ promotedWarningCategories: [...JULIUS_CHALLENGE_CATEGORIES] });
    expect(every.ok && every.contract.promotedWarningCategories).toEqual([...JULIUS_CHALLENGE_CATEGORIES]);
  });

  it.each([
    ['a kind Julius does not have', ['contract-drift']],
    ['a kind in another case', ['Contract_Drift']],
    ['a kind named twice', ['regression', 'regression']],
    ['an empty list, which would read as a promotion and promote nothing', []],
    ['a single kind not in a list', 'contract_drift'],
    ['a kind that is not a string', [7]],
    ['null', null],
  ])('refuses %s, by name, rather than dropping it', (_name, value) => {
    expect(parse({ promotedWarningCategories: value })).toEqual({ ok: false, problem: REFUSAL });
  });

  it('is part of the mission\'s identity: a promoting arm is a different run from the same mission without it', () => {
    const without = digestOf({});
    expect(digestOf({ promotedWarningCategories: ['contract_drift'] })).not.toBe(without);
    expect(digestOf({ promotedWarningCategories: ['contract_drift'] })).not.toBe(digestOf({ promotedWarningCategories: ['regression'] }));
    // Absent is absent: no key in the parsed contract, so nothing it would add to the digest.
    const parsed = parse({});
    expect(parsed.ok && Object.keys(parsed.contract)).not.toContain('promotedWarningCategories');
  });
});

describe('the paid run composes what the contract says', () => {
  it('passes the contract\'s kinds to the runtime, and nothing when it names none', () => {
    const promoting = parse({ promotedWarningCategories: ['contract_drift'] });
    const ordinary = parse({});
    if (!promoting.ok || !ordinary.ok) throw new Error('fixture');
    expect(liveVerificationOptions(promoting.contract)).toEqual({ maxRepairRounds: 2, promotedWarningCategories: ['contract_drift'] });
    expect(liveVerificationOptions(ordinary.contract)).toEqual({ maxRepairRounds: 2 });
    expect(liveVerificationOptions({ limits: undefined })).toEqual({ maxRepairRounds: 1 });
  });
});

describe('no frozen mission moves', () => {
  /**
   * THE RUN IDENTITIES THE PAID RECORD IS FILED UNDER. A mission's binding
   * digest is the hash of its PARSED contract, and its first 24 hex digits are
   * its Julius run id: Mission 2's paid run is `run:4bf13d0e…` and Mission 6's
   * attempts are `run:efb6e20f…`. The contract BYTES are pinned by git object id
   * (`.github/julius-mission-pins.txt`); these pin what the PARSER makes of
   * them, so a parser change that would quietly turn a frozen mission into a
   * different run fails here first. Computed on this branch and on its base:
   * identical.
   */
  const FROZEN: Readonly<Record<string, string>> = {
    'julius-live-mission-2': 'sha256:4bf13d0e833a042c74f57555aa7fc520aab8941b5bc621dcef35c975b87b714b',
    'julius-live-mission-3': 'sha256:132b1d96d9eebad0ecf386d541169559057ecc2c93aa7cce7853ed9f2eb5a723',
    'julius-live-mission-5': 'sha256:cecba99c779c967f128dd58c58de5d362e5da37afef2a7974f9fface4b44cc80',
    'julius-live-mission-6': 'sha256:efb6e20f0d11885bc5085a6835d5d27ef0441dfebf14480d0972fdee07ecf71b',
  };

  it('every frozen mission parses to the identity its paid runs carry', () => {
    for (const [mission, digest] of Object.entries(FROZEN)) {
      const parsed = parseLiveMissionContract(readFileSync(join(ROOT, '.github', 'julius-missions', mission, 'contract.json'), 'utf8'));
      if (!parsed.ok) throw new Error(`${mission}: ${parsed.problem}`);
      expect(compileBootstrapRequest(parsed.contract, [], 'card').missionBindingDigest, mission).toBe(digest);
    }
  });

  it('no committed mission promotes a warning today: choosing option B is a contract edit someone makes', () => {
    const missions = readdirSync(join(ROOT, '.github', 'julius-missions'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(missions.length, 'the committed missions were found').toBeGreaterThanOrEqual(7);
    for (const mission of missions) {
      const parsed = parseLiveMissionContract(readFileSync(join(ROOT, '.github', 'julius-missions', mission, 'contract.json'), 'utf8'));
      expect(parsed.ok, mission).toBe(true);
      expect(parsed.ok && parsed.contract.promotedWarningCategories, mission).toBeUndefined();
    }
  });
});

describe('the run says what it will promote, before any spend', () => {
  let dir = '';
  let entry = '';
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'julius-promotion-'));
    entry = join(dir, 'entry.cjs');
    const { build } = await import('esbuild');
    await build({
      entryPoints: [join(ROOT, 'relay-bridge/julius-live-mission.ts')],
      bundle: true, platform: 'node', format: 'cjs', outfile: entry,
      external: ['@anthropic-ai/claude-agent-sdk', 'pg'], logLevel: 'warning',
    });
  }, 60_000);
  afterAll(() => { if (dir !== '') rmSync(dir, { recursive: true, force: true }); });

  const preflight = (fields: Record<string, unknown>): string => {
    const path = join(dir, `contract-${String(Object.keys(fields).length)}.json`);
    writeFileSync(path, JSON.stringify({ ...BASE, ...fields }));
    try {
      return execFileSync(process.execPath, [entry, 'run', '--contract', path], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', NODE_PATH: join(ROOT, 'node_modules') },
      });
    } catch (error) {
      // A preflight with no providers configured exits non-zero; what it said is what matters here.
      return String((error as { stdout?: string }).stdout ?? '');
    }
  };

  it('a promoting contract says so in the preflight, the evidence keeps the line, and an ordinary one says nothing new', () => {
    const promoting = preflight({ promotedWarningCategories: ['contract_drift', 'missed_acceptance_criterion'] });
    const line = '  review policy: warnings promoted to blocking by this contract: contract_drift, missed_acceptance_criterion';
    expect(promoting.split('\n')).toContain(line);
    expect(promoting.indexOf(line), 'said before the providers are named, let alone paid').toBeLessThan(promoting.indexOf('requested models:'));
    expect(preflight({})).not.toContain('review policy:');
    const kept = execFileSync(process.execPath, [join(ROOT, 'scripts/julius-live-evidence.mjs'), '-'], { input: promoting, encoding: 'utf8' });
    expect(kept.split('\n'), 'the evidence allowlist keeps it').toContain(line);
  }, 60_000);
});
