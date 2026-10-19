import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * V6 G-W: THE STRUCTURE OF THE FOUNDER'S IN-JOB APPROVAL STEP, pinned from the workflow's own text.
 *
 * `.github/workflows` is the founder's alone: no agent writes it. So this file has TWO honest states, and both assert something:
 *
 *   ABSENT   the live workflow does not yet carry the approval steps (before the founder's commit). Then NOTHING in it may
 *            reference the decide CLI, and the LIVE step must still pass its exit status through unchanged: an ungated
 *            mission sees no behaviour change.
 *   PRESENT  the workflow carries them. Then every property of V6_FOUNDER_WORKFLOW_GW (section 4) is asserted: the request
 *            and the wait hold no provider credential and take only the job token, no event or comment text is ever
 *            interpolated into a script, the resume step is the SAME environment as LIVE and needs an APPROVED decision,
 *            a held run can complete only through the final invocation, the window fits the step timeout, and the founder's
 *            four literals are real values.
 *
 * To check the DRAFT before the founder commits it, point JULIUS_GW_WORKFLOW_PATH at the draft file: the file is then judged in
 * PRESENT mode and the literals may still be the visible placeholders. (Unset, the repository's own workflow is judged and the
 * placeholders are refused.)
 */

const ROOT = resolve(__dirname, '..');
const OVERRIDE = process.env.JULIUS_GW_WORKFLOW_PATH;
const workflowPath = OVERRIDE !== undefined && OVERRIDE !== '' ? resolve(OVERRIDE) : resolve(ROOT, '.github/workflows/julius-first-live-mission.yml');
const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n/gu, '\n');
const present = workflow.includes('id: approval_request');
const draftMode = OVERRIDE !== undefined && OVERRIDE !== '';

/** One step's text, from its `- name:` line to the next step or top-level key. */
function step(id: string): string {
  const at = workflow.indexOf(`        id: ${id}\n`);
  expect(at, `step ${id} must exist`).toBeGreaterThan(-1);
  const start = workflow.lastIndexOf('\n      - ', at) + 1;
  const rest = workflow.slice(start);
  const end = rest.indexOf('\n      - ', 1);
  const next = rest.indexOf('\n      # ', 1);
  const cut = [end, next].filter((n) => n > 0);
  return cut.length === 0 ? rest : rest.slice(0, Math.min(...cut));
}

const envBlock = (text: string): string => {
  const at = text.indexOf('        env:\n');
  if (at < 0) return '';
  const rest = text.slice(at);
  const end = rest.indexOf('        run: |\n');
  return end < 0 ? rest : rest.slice(0, end);
};
const runBody = (text: string): string => text.slice(text.indexOf('        run: |\n'));
const envKeys = (text: string): string[] =>
  envBlock(text).split('\n').slice(1).filter((line) => /^ {10}[A-Z_][A-Z0-9_]*:/u.test(line)).map((line) => line.trim().split(':')[0]!);

const PROVIDER = /OPENAI_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|JULIUS_SCOPED_CREDENTIALS|ANTHROPIC|XAI_|GROK|secrets\./u;

describe('V6 G-W workflow: before the founder\'s commit (ABSENT)', () => {
  it('does not reference the decide CLI anywhere and leaves the LIVE step\'s exit untouched', () => {
    if (present) { expect(workflow, 'workflow draft committed: the decide CLI is referenced').toContain('julius-approval-decide'); return; }
    expect(workflow).not.toContain('julius-approval-decide');
    expect(workflow).not.toContain('live_final');
    const live = step('live_mission');
    expect(live).toContain('exit "$status"');
    expect(live).not.toContain('held=');
  });
});

describe('V6 G-W workflow: the approval steps (PRESENT)', () => {
  it('the five steps exist, in order, and the build step also builds the decide CLI', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    const order = ['live_mission', 'approval_request', 'operator', 'live_resume', 'live_final'].map((id) => workflow.indexOf(`        id: ${id}\n`));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(workflow).toMatch(/npm run relay:julius:decide:build/u);
  });

  it('the request and the wait hold NO provider credential and take only the job token', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    for (const id of ['approval_request', 'operator']) {
      const text = step(id);
      expect(envKeys(text), `${id} env is exactly GH_TOKEN`).toEqual(['GH_TOKEN']);
      expect(envBlock(text)).toContain('GH_TOKEN: ${{ github.token }}');
      expect(text, `${id} must name no provider credential and no secret`).not.toMatch(PROVIDER);
    }
  });

  it('no event, comment or issue text is ever interpolated into a script; request and wait have no expression in their scripts', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    for (const id of ['approval_request', 'operator']) {
      expect(runBody(step(id)), `${id} script`).not.toContain('${{');
    }
    const finalScript = runBody(step('live_final'));
    const expressions = finalScript.match(/\$\{\{[^}]*\}\}/gu) ?? [];
    for (const expression of expressions) {
      expect(expression, 'only step outcomes and the held flag may be interpolated').toMatch(/^\$\{\{ steps\.(live_mission|live_resume)\.(outcome|outputs\.held) \}\}$/u);
    }
    for (const id of ['approval_request', 'operator', 'live_resume', 'live_final']) {
      expect(step(id), `${id} must not read github.event`).not.toMatch(/github\.event/u);
    }
  });

  it('request and wait run only for a HELD run of a paid dispatch, and the resume needs an APPROVED decision', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    for (const id of ['approval_request', 'operator', 'live_resume']) {
      const text = step(id);
      expect(text).toMatch(/if: success\(\) && inputs\.confirm_live == 'RUN LIVE MISSION' && steps\.live_mission\.outputs\.held == 'true'/u);
    }
    expect(step('live_resume')).toContain("steps.operator.outputs.decision == 'APPROVED'");
  });

  it('LIVE (resume) has EXACTLY the environment of LIVE: same credentials, no more, no fewer', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    expect(envBlock(step('live_resume'))).toBe(envBlock(step('live_mission')));
  });

  it('LIVE treats exit 3 as success ONLY for a held run of a contract that declares a gate, and says so in held=', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    const body = runBody(step('live_mission'));
    expect(body).toContain('"$status" = "$JULIUS_HELD_EXIT"');
    expect(body).toContain('(.approvalGates | type) == "array" and (.approvalGates | length) > 0');
    expect(body).toContain("echo 'held=true'");
    expect(body).toContain("echo 'held=false'");
    expect(body.trimEnd().endsWith('exit "$status"'), 'every other exit status is passed through').toBe(true);
  });

  it('the held-exit literal is the entrypoint\'s own constant', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    const lines = readFileSync(resolve(ROOT, 'relay-bridge/julius/live-report-lines.ts'), 'utf8');
    const constant = /export const JULIUS_EXIT_HELD_FOR_APPROVAL\s*=\s*(\d+)/u.exec(lines)?.[1];
    expect(constant, 'live-report-lines.ts declares JULIUS_EXIT_HELD_FOR_APPROVAL (the entrypoint exits with it)').toBeDefined();
    expect(workflow).toContain(`JULIUS_HELD_EXIT: '${constant}'`);
  });

  it('the wait is bounded: its step timeout is the window plus five minutes, inside the paid job\'s timeout', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    const window = Number(/JULIUS_APPROVAL_WINDOW_MINUTES: '(\d+)'/u.exec(workflow)?.[1]);
    expect(Number.isInteger(window) && window >= 1 && window <= 30, 'the window is 1-30 minutes').toBe(true);
    expect(step('operator')).toContain(`timeout-minutes: ${window + 5}`);
    const jobTimeout = Number(/timeout-minutes: (\d+)\n {4}environment: julius-live-validation/u.exec(workflow)?.[1]);
    expect(jobTimeout).toBeGreaterThanOrEqual(300);
  });

  it('a held run can complete only through the FINAL invocation, and everything that follows reads that', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    const final = step('live_final');
    expect(final).toContain("if: always() && inputs.confirm_live == 'RUN LIVE MISSION'");
    // Completion needs the first invocation to have SUCCEEDED and not been held, or the resume to have succeeded; nothing else.
    expect(runBody(final)).toContain("[ '${{ steps.live_mission.outcome }}' = success ] && [ '${{ steps.live_mission.outputs.held }}' = false ]");
    expect(runBody(final)).toContain("elif [ '${{ steps.live_resume.outcome }}' = success ]; then c=true");
    expect(runBody(final)).toContain('else c=false; fi');
    expect(workflow, 'no later step may read the first invocation alone').not.toMatch(/steps\.live_mission\.outcome == 'success'/u);
    const readers = workflow.match(/steps\.live_final\.outputs\.completed == 'true'/gu) ?? [];
    expect(readers.length, 'the completed marker, its upload and the learning store read live_final').toBeGreaterThanOrEqual(3);
  });

  it('the founder\'s four literals are real values (placeholders are refused once the steps are committed)', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    const issue = /JULIUS_APPROVAL_ISSUE: '([^']*)'/u.exec(workflow)?.[1] ?? '';
    const logins = /JULIUS_APPROVER_LOGINS: '([^']*)'/u.exec(workflow)?.[1] ?? '';
    if (draftMode) {
      expect(issue).toMatch(/^(\d{1,10}|FOUNDER_FILLS_ISSUE_NUMBER)$/u);
      expect(logins).toMatch(/^([A-Za-z0-9][A-Za-z0-9-]{0,38}#[1-9]\d{0,19}|FOUNDER_FILLS_LOGIN#NUMERIC_USER_ID)$/u);
    } else {
      expect(issue, 'an issue number').toMatch(/^[1-9]\d{0,9}$/u);
      expect(logins, 'login#numeric id entries').toMatch(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}#[1-9]\d{0,19}$/u);
    }
  });

  it('the job token cannot write: the workflow\'s permissions stay read-only', () => {
    if (!present) { expect(workflow, 'workflow draft not committed: no approval step exists yet').not.toContain('julius-approval-decide'); return; }
    const block = /\npermissions:\n((?: {2}[a-z-]+: [a-z]+\n)+)/u.exec(workflow)?.[1] ?? '';
    expect(block).toContain('issues: read');
    expect(block).not.toMatch(/: write/u);
  });
});

describe('V6 G-W: a gated mission fits the job (E10), whichever state the workflow is in', () => {
  it('every committed mission that declares approvalGates pre-registers repairCycles <= 2', () => {
    const dir = resolve(ROOT, '.github/julius-missions');
    for (const name of readdirSync(dir)) {
      const file = resolve(dir, name, 'contract.json');
      if (!existsSync(file)) continue;
      const contract = JSON.parse(readFileSync(file, 'utf8')) as { approvalGates?: unknown[]; limits?: { repairCycles?: number } };
      if (contract.approvalGates === undefined) continue;
      expect(contract.limits?.repairCycles ?? Infinity, `${name}: a gated mission needs repairCycles <= 2 to fit the 300-minute job with the window`).toBeLessThanOrEqual(2);
    }
  });
});
