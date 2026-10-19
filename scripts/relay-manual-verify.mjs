#!/usr/bin/env node
/**
 * Manual Task demo acceptance verification (Prompt 6.1). Runs the bundled
 * manual scenario twice in JSON mode and checks SEMANTIC outcomes
 * (ids/timestamps may differ). Node built-ins only. Exit 0 only when every
 * check passes. Mirrors scripts/relay-yc-verify.mjs without touching it.
 */
import { execFileSync } from 'node:child_process';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const gitStatus = () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });

function runOnce(label) {
  const raw = execFileSync('node', ['dist-relay/cli.cjs', 'demo', 'manual', '--json', '--pace', '0'], { encoding: 'utf8' });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    check(`${label}: JSON parses`, false);
    return null;
  }
  check(`${label}: JSON parses`, true);
  check(`${label}: no ANSI in JSON`, !raw.includes(''));
  check(`${label}: completed`, data.finalStatus === 'completed', data.finalStatus);
  check(`${label}: exit code 0`, data.exitCode === 0, String(data.exitCode));
  const task = data.manualTask;
  check(`${label}: manual task present`, Boolean(task?.manualTaskId));
  check(`${label}: manual task completed`, task?.status === 'completed', task?.status);
  check(`${label}: verification passed`, task?.verification?.lastOutcome === 'passed');
  check(`${label}: checkpoint association`, Boolean(task?.checkpointId) && task?.checkpointId === data.status?.checkpoint?.checkpointId);
  check(`${label}: three to six steps`, Array.isArray(task?.steps) && task.steps.length >= 3 && task.steps.length <= 6, `steps=${task?.steps?.length}`);
  check(`${label}: short steps`, (task?.steps ?? []).every((s) => s.length <= 90));
  check(`${label}: short title`, typeof task?.title === 'string' && task.title.split(/\s+/).length <= 7, task?.title);
  check(`${label}: what-relay-will-do-next present`, typeof task?.whatRelayWillDoNext === 'string' && task.whatRelayWillDoNext.length > 0);
  check(`${label}: validated by relay`, task?.validatedByRelay === true);
  check(`${label}: audit records the manual task`, (data.audit?.manualTasks ?? []).length === 1 && data.audit.manualTasks[0].status === 'completed');
  check(`${label}: audit records the done response`, (data.audit?.manualTasks?.[0]?.responses ?? []).includes('done'));
  const kinds = (data.events ?? []).map((e) => e.kind);
  const order = [
    'run.created', 'manual.action_requested', 'manual.request_validated',
    'run.checkpoint_required', 'manual.task_created', 'manual.response_recorded',
    'manual.verification_started', 'manual.verification_passed',
    'manual.task_completed', 'run.resumed', 'run.completed',
  ];
  let cursor = -1;
  const ordered = order.every((k) => {
    const idx = kinds.indexOf(k, cursor + 1);
    if (idx === -1) return false;
    cursor = idx;
    return true;
  });
  check(`${label}: manual milestone ordering stable`, ordered);
  const stopIdx = kinds.indexOf('run.checkpoint_required');
  const resumeIdx = kinds.indexOf('run.resumed');
  const dispatched = kinds.slice(stopIdx, resumeIdx).some((k) => k.startsWith('agent.session'));
  check(`${label}: no agent dispatch while stopped`, stopIdx !== -1 && resumeIdx > stopIdx && !dispatched);
  const sequences = (data.events ?? []).map((e) => e.sequence);
  check(`${label}: event sequence monotonic`, sequences.every((v, i) => i === 0 || v > sequences[i - 1]));
  check(`${label}: no secret-shaped output`, !/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/.test(raw));
  return data;
}

console.log('RELAY MANUAL TASK DEMO VERIFICATION');
const statusBefore = gitStatus();
const first = runOnce('run 1');
const second = runOnce('run 2');
if (first && second) {
  const semantic = (d) => ({
    finalStatus: d.finalStatus, exitCode: d.exitCode,
    manualStatus: d.manualTask?.status, verification: d.manualTask?.verification?.lastOutcome,
    steps: d.manualTask?.steps, eventKinds: (d.events ?? []).map((e) => e.kind),
  });
  check('repeated runs preserve semantic outcome', JSON.stringify(semantic(first)) === JSON.stringify(semantic(second)));
}
check('no repository modifications during runs', gitStatus() === statusBefore);
check('no provider environment consumed', !process.env.RELAY_TEST_FAKE_PROVIDER_CALL);

if (failures.length > 0) {
  console.log(`\nVERIFICATION FAILED: ${failures.length} check(s): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nVERIFICATION PASSED — the Manual Task demo is recording-ready.');
