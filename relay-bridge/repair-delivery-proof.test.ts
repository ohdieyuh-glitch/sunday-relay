import { describe, it, expect } from 'vitest';
import { runCodingMission } from './coding';
import { resolveClaudeRuntime } from './claude-runtime';
import { createRandomIdFactory } from '../src/relay/protocol/ids';
import { compileRevisionPrompt } from '../src/relay/connectors/claude-code/prompt-compiler';
import { CLAIMED_FILE } from '../src/relay/connectors/claude-code/fixture';
import type { BridgeEventInput } from './types';

/**
 * A PROMPT IS PROVEN AGAINST WHAT IT IS SUPPOSED TO CARRY.
 *
 * `coding.ts` proves handoff delivery by checking the compiled prompt contains
 * the architect's objective. That is right for a first attempt and WRONG for a
 * repair: `compileRevisionPrompt` is deliberately narrow — "do not restart or
 * broaden the task", findings only — so it never restates the objective.
 *
 * Applying the first-attempt check to the repair prompt stopped every repair in
 * production:
 *
 *   Repair attempt started — 2 blocking finding(s).
 *   Repair produced no verifiable result — the original review stands.
 *   The repair run stopped: The compiled prompt did not carry the Prompt
 *   Architect handoff.
 *
 * Every sentence there was true. The check was asking the wrong question of the
 * right prompt, and only a live mission could see it, because no test had ever
 * driven the coding leg with a `revision` and asked what the delivery proof
 * would say about it.
 *
 * So this drives the REAL leg — real child process, real worktree, real edit,
 * real `node --test` — with a revision. A prompt-compiler unit test cannot
 * catch this defect: neither prompt was wrong. The code choosing between them
 * was.
 *
 * WHAT THESE TESTS DO NOT DO, stated because the first draft claimed it. Both
 * delivery proofs are unreachable from input, so neither can be probed by
 * feeding this leg a hostile value. I measured that rather than assuming it:
 * a 792-character objective and a 761-character multiline finding both pass
 * through intact, because nothing on either path truncates them. They are
 * wiring-break guards. The probe that proves they still bite is therefore a
 * SOURCE mutation, run on this host: collapsing the branch back to
 * `if (true)` — one matched site, asserted — fails the first two tests here.
 */

const runLeg = async (over: Partial<Parameters<typeof runCodingMission>[0]> = {}) => {
  const now = () => new Date().toISOString();
  const runtime = resolveClaudeRuntime('fake', now, true);
  expect(runtime.ok).toBe(true);
  if (!runtime.ok) throw new Error('fake runtime unavailable');

  const events: BridgeEventInput[] = [];
  const outcome = await runCodingMission({
    handoff: {
      objective: 'Implement normalizeProjectName so the existing tests pass.',
      instructions: ['Trim, lowercase, and collapse separators.'],
      acceptanceCriteria: ['The existing test suite passes when Relay runs it.'],
      constraints: ['Edit only the claimed file.'],
    },
    executablePath: runtime.runtime.executablePath,
    capabilities: runtime.runtime.capabilities,
    now,
    ids: createRandomIdFactory(),
    emit: (e) => events.push(e),
    publishTerminal: () => {},
    projectLabel: 'Relay controlled fixture (throwaway repository)',
    ...over,
  });
  return { outcome, events };
};

/** The bytes the Reviewer read, as the repair leg supplies them. */
const REVIEWED_BYTES = 'function normalizeProjectName(name) { return name; }\nmodule.exports = { normalizeProjectName };\n';

const FINDINGS = [
  'F-1: normalizeProjectName returns its argument unchanged.',
  'F-2: separators are never collapsed.',
];

const revision = (over: Partial<{ findingSummaries: string[]; priorContents: Record<string, string> }> = {}) => ({
  findingSummaries: FINDINGS,
  priorContents: { [CLAIMED_FILE]: REVIEWED_BYTES },
  ...over,
});

describe('the delivery proof asks each prompt for what that prompt carries', () => {
  it('does not stop a REPAIR for missing the objective', async () => {
    // The regression itself, and the assertion that matters is the negative
    // one: a repair may still fail for its own reasons, but never for this.
    const { outcome } = await runLeg({ revision: revision() });
    expect(outcome.stopReason ?? '').not.toContain('Prompt Architect handoff');
  }, 60_000);

  it('runs the repair through to a verified result', async () => {
    // Not merely "didn't stop for the wrong reason" — the leg completes, which
    // is what makes a re-review possible at all.
    const { outcome } = await runLeg({ revision: revision() });
    expect(outcome.stopped).toBe(false);
    expect(outcome.verificationPassed).toBe(true);
  }, 60_000);

  it('a first attempt is still judged against the objective', async () => {
    // The other half of the split. It cannot be probed by input (see the top
    // note), so what is asserted is the reachable half: a first attempt whose
    // prompt DOES carry the objective is not stopped by a check meant for it.
    const { outcome } = await runLeg();
    expect(outcome.stopped).toBe(false);
    expect(outcome.stopReason).toBeNull();
  }, 60_000);

  it('ignores prior content for a path the first attempt could not claim', async () => {
    /**
     * The seeding guard, which IS reachable from input and is the one place a
     * repair could widen scope through the back door. Seeding `package.json`
     * would leave an unclaimed, protected file modified in the worktree, and
     * Relay's own inspection would fail the run.
     *
     * That the run still verifies is the proof the `continue` held.
     */
    const { outcome } = await runLeg({
      revision: revision({
        priorContents: {
          [CLAIMED_FILE]: REVIEWED_BYTES,
          'package.json': '{"name":"seeded-through-the-back-door"}',
        },
      }),
    });
    expect(outcome.stopped).toBe(false);
    expect(outcome.verificationPassed).toBe(true);
    expect(outcome.filesChanged).toEqual([CLAIMED_FILE]);
  }, 60_000);
});

describe('the two prompts carry different things, which is why the check had to split', () => {
  const prompt = compileRevisionPrompt({
    runId: 'run-1',
    taskId: 'task-1',
    findingSummaries: FINDINGS,
    relayVerificationCommands: ['node --test test/normalize.test.js'],
  });

  it('the revision prompt carries every finding', () => {
    for (const f of FINDINGS) expect(prompt).toContain(f);
  });

  it('the revision prompt deliberately does not restate the objective', () => {
    // Pinned so nobody "fixes" the revision prompt by widening it back out,
    // which would make the original check look correct again.
    expect(prompt).not.toContain('Implement normalizeProjectName');
    expect(prompt).toContain('Do not restart or broaden the task');
  });
});
