import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * VERIFICATION APPROPRIATE TO THE TASK, NOT VERIFICATION HARDCODED TO ONE CLASS.
 *
 * `julius-live-contract-check.mjs` used to put `testCommand` in the same
 * non-empty-string loop as `missionId` and `objective`. That one line refused two
 * of the four mission classes Julius exists to serve, before a provider was ever
 * contacted, and with a message that read like a malformed contract rather than
 * an unsupported mission class.
 *
 * It was a contradiction, not an omission. `relay-bridge/julius/mission-contract.ts`
 * documents that an empty command is a DELIBERATE DECLARATION, and the whole
 * runtime already honoured it: the compiler sets `deterministicCheck: { declared:
 * false }`, the live coder runs nothing, records no TEST row, and the build is
 * held to the DIFF it produced. Every piece worked except the door.
 *
 * THE REPLACEMENT IS NOT "ANYONE MAY DROP THE COMMAND". These cases hold both
 * halves of the rule, because either half alone is a hole:
 *
 *   - a mission may declare that it has no deterministic check;
 *   - a mission may NOT claim a test proves it and then ship no test, which is
 *     the same claim with the checking removed;
 *   - and under an empty command every BLOCKING criterion must say what DOES
 *     prove it, so "no check" cannot quietly become "no standard".
 */

const ROOT = resolve(import.meta.dirname, '..');
const CHECKER = resolve(ROOT, 'scripts/julius-live-contract-check.mjs');

const check = (contract: unknown): { code: number; output: string } => {
  const file = join(mkdtempSync(join(realpathSync(tmpdir()), 'julius-verify-')), 'contract.json');
  writeFileSync(file, JSON.stringify(contract));
  try {
    return { code: 0, output: execFileSync(process.execPath, [CHECKER, file], { encoding: 'utf8' }) };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
};

/**
 * A mission on an UNREGISTERED namespace, deliberately: it takes the default $5
 * and one repair cycle, so these cases also show that a brand-new mission runs
 * without anyone adding a table row.
 */
const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  missionId: 'mission:verification-modes',
  markerNamespace: 'julius-verification-modes',
  projectId: 'prj-verification-modes',
  tenantId: 'tenant',
  objective: 'A mission whose verification mode is the thing under test.',
  requirements: ['Do the work the objective names.'],
  constraints: ['Change nothing outside the workspace.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The work is done.', blocking: true }],
  testCommand: 'node --test src/thing.test.ts',
  workspacePath: '/tmp/julius-workspace/tenant/ws',
  limits: { spendUsd: 5, repairCycles: 1 },
  ...overrides,
});

describe('a contract declares how it is verified, and the gate holds it to that', () => {
  /** A — the ordinary code mission, unchanged by any of this. */
  it('A. a coding mission that requires a deterministic check and ships one is accepted', () => {
    const result = check(base({
      acceptanceCriteria: [
        { id: 'AC-1', text: 'The suite exits zero.', blocking: true, requiredEvidence: ['TEST'] },
        { id: 'AC-2', text: 'The change is visible in the diff.', blocking: true, requiredEvidence: ['DIFF'] },
      ],
      testCommand: 'node --test src/thing.test.ts',
    }));
    expect(result.output, result.output).toContain('CONTRACT OK');
    expect(result.code).toBe(0);
  });

  /**
   * B — THE EVASION CASE, and the reason this is a consistency rule rather than a
   * presence rule. The mission still SAYS a test proves it; only the test is
   * gone. A presence rule cannot tell this apart from a report mission, which is
   * exactly why the old blanket rule had to refuse both.
   */
  it('B. a mission that claims TEST evidence while shipping no test command is refused', () => {
    const result = check(base({
      acceptanceCriteria: [{ id: 'AC-1', text: 'The suite exits zero.', blocking: true, requiredEvidence: ['TEST'] }],
      testCommand: '',
    }));
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain('requires TEST evidence while testCommand is empty');
  });

  it('B2. whitespace is not a test command either', () => {
    const result = check(base({
      acceptanceCriteria: [{ id: 'AC-1', text: 'The suite exits zero.', blocking: true, requiredEvidence: ['TEST'] }],
      testCommand: '   ',
    }));
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain('requires TEST evidence while testCommand is empty');
  });

  /** C — the class the old rule refused outright. */
  it('C. a report mission with no deterministic check, naming what does prove it, is accepted', () => {
    const result = check(base({
      objective: 'Compare the three candidate storage engines and recommend one, with the reasoning.',
      acceptanceCriteria: [
        { id: 'AC-1', text: 'The comparison covers all three engines.', blocking: true, requiredEvidence: ['DIFF'] },
        { id: 'AC-2', text: 'A single recommendation is stated with its reasoning.', blocking: true, requiredEvidence: ['DIFF'] },
      ],
      testCommand: '',
    }));
    expect(result.output, result.output).toContain('CONTRACT OK');
    expect(result.code).toBe(0);
  });

  /**
   * E — an empty command may not bypass a verification requirement stated
   * anywhere in the contract, including a criterion that is not blocking. A
   * non-blocking criterion is still a claim the reviewer is shown, and letting it
   * name a test nothing runs would put an unmet standard in front of a judge.
   */
  it('E. a NON-blocking criterion requiring TEST also refuses an empty command', () => {
    const result = check(base({
      acceptanceCriteria: [
        { id: 'AC-1', text: 'The report exists.', blocking: true, requiredEvidence: ['DIFF'] },
        { id: 'AC-2', text: 'The suite exits zero.', blocking: false, requiredEvidence: ['TEST'] },
      ],
      testCommand: '',
    }));
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain('requires TEST evidence while testCommand is empty');
  });

  /**
   * THE OTHER HALF OF THE RULE. Without this, "no deterministic check" would
   * quietly become "no standard", and the Independent Reviewer would be asked for
   * an opinion rather than a judgement against something.
   */
  it('an empty command with a blocking criterion that names nothing is refused', () => {
    const result = check(base({
      acceptanceCriteria: [{ id: 'AC-1', text: 'The report is good.', blocking: true }],
      testCommand: '',
    }));
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain('must declare requiredEvidence');
  });

  it('it names the offending criterion, so a refusal is actionable', () => {
    const result = check(base({
      acceptanceCriteria: [
        { id: 'AC-1', text: 'The report exists.', blocking: true, requiredEvidence: ['DIFF'] },
        { id: 'AC-NAMED', text: 'The reasoning is sound.', blocking: true },
      ],
      testCommand: '',
    }));
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain('AC-NAMED');
  });

  /**
   * THE REFUSAL MUST NAME THE ONE LEGAL ANSWER.
   *
   * With an empty command, `TEST` is already refused by the evasion rule, which
   * leaves exactly one value this criterion can legally declare. A rule with one
   * legal answer that makes the caller guess it is a bad rule.
   *
   * The first caller to hit this was the integration lane's execution-profile
   * probe: a synthetic one-criterion contract composed through this parser to
   * validate an operator profile, where the right value was never in doubt. The
   * message now says DIFF, and says why it follows — the deliverable has to be a
   * real change to a tracked path, which is the consequence a profile author is
   * most likely to miss.
   */
  it('the refusal names DIFF, and says what that implies about the deliverable', () => {
    const probe = check(base({
      acceptanceCriteria: [{ id: 'probe', text: 'The profile composes a usable mission.', blocking: true }],
      testCommand: '',
    }));
    expect(probe.code, probe.output).not.toBe(0);
    expect(probe.output, 'a caller must not have to guess the only legal value').toContain('["DIFF"]');
    expect(probe.output).toContain('real change to a tracked path');
    // And taking the advice the message gives must actually work.
    const fixed = check(base({
      acceptanceCriteria: [{ id: 'probe', text: 'The profile composes a usable mission.', blocking: true, requiredEvidence: ['DIFF'] }],
      testCommand: '',
    }));
    expect(fixed.output, fixed.output).toContain('CONTRACT OK');
  });

  /** ABSENT is still malformed: an omission is not a declaration. */
  it('a MISSING testCommand is still refused, because leaving it out decides nothing', () => {
    const { testCommand: _dropped, ...withoutField } = base();
    const result = check(withoutField);
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain('testCommand');
  });

  /**
   * THE PARKING GUARD. The kernel declares twelve evidence types and it is
   * tempting to let a contract name any of them. On the live path a BUILD task
   * produces only TEST and DIFF — every ARTIFACT row belongs to the architect, a
   * consultation or a rebuttal, and `verifyTask` scopes evidence to the task. A
   * contract allowed to require ARTIFACT would pass every check and then park in
   * VERIFYING forever, AFTER the whole mission's spend. A refusal is cheaper.
   */
  it.each([['ARTIFACT'], ['BUILD'], ['USER_APPROVAL'], ['TOOL_RECEIPT'], ['REVIEW_FINDING'], ['NOT_A_TYPE']])(
    'refuses %s, which a live build never records', (type) => {
      const result = check(base({
        acceptanceCriteria: [{ id: 'AC-1', text: 'x', blocking: true, requiredEvidence: [type] }],
        testCommand: '',
      }));
      expect(result.code, result.output).not.toBe(0);
      expect(result.output).toContain('which a live build never records');
    });

  it('refuses a requiredEvidence that is present but not a non-empty array', () => {
    for (const bad of [[], 'TEST', {}, null]) {
      const result = check(base({
        acceptanceCriteria: [{ id: 'AC-1', text: 'x', blocking: true, requiredEvidence: bad }],
      }));
      expect(result.code, `${JSON.stringify(bad)} → ${result.output}`).not.toBe(0);
    }
  });

  /**
   * NO DRIFT. Every contract already in the repository must still pass, or this
   * change is a silent re-specification of five paid missions rather than a fix.
   */
  it('every mission contract in this repository still passes unchanged', () => {
    const dir = join(ROOT, '.github/julius-missions');
    const missions = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(missions.length, 'the mission corpus should not be empty').toBeGreaterThan(1);
    for (const mission of missions) {
      const contract = JSON.parse(readFileSync(join(dir, mission, 'contract.json'), 'utf8')) as unknown;
      const result = check(contract);
      expect(result.output, `${mission}: ${result.output}`).toContain('CONTRACT OK');
    }
  });

  /**
   * AND THE TWO FILES MUST AGREE. The gate is dependency-free and cannot import
   * the parser, so the parser's rule is repeated there. A drift would mean the
   * bridge route accepts a contract the paid preflight refuses, which is the
   * exact shape of the defect this change fixes.
   */
  it('the parser and the gate agree that an empty command is a declaration', () => {
    const parser = readFileSync(join(ROOT, 'relay-bridge/julius/mission-contract.ts'), 'utf8');
    const gate = readFileSync(CHECKER, 'utf8');
    expect(parser, 'the parser must still permit an empty command').toContain('MUST BE PRESENT AND MAY BE EMPTY');
    expect(gate, 'the gate must no longer demand a non-empty command').not.toMatch(
      /\['missionId',[^\]]*'testCommand'/u,
    );
    expect(gate, 'the gate must name the producible evidence in one place')
      .toContain("const BUILD_EVIDENCE = ['TEST', 'DIFF']");
  });
});
