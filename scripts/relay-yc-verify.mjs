#!/usr/bin/env node
/**
 * YC demo acceptance verification (Prompt 6). Runs the bundled YC scenario
 * twice in JSON mode and checks SEMANTIC outcomes (ids/timestamps may
 * differ). Node built-ins only. Exit 0 only when every check passes.
 */
import { execFileSync } from 'node:child_process';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const gitStatus = () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });

function runOnce(label) {
  const raw = execFileSync('node', ['dist-relay/cli.cjs', 'demo', 'yc', '--json', '--pace', '0'], { encoding: 'utf8' });
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
  check(`${label}: exactly one repair`, data.audit?.repairCount === 1);
  check(`${label}: final audit exists`, Boolean(data.audit?.auditId));
  check(`${label}: simulation notice`, typeof data.audit?.simulationNotice === 'string' && data.audit.simulationNotice.includes('SIMULATED'));
  check(`${label}: provenance simulated`, data.audit?.provenanceProfile === 'simulated');
  check(`${label}: completion policy passed`, (data.audit?.claimPromotions ?? []).length > 0 && (data.audit?.claimPromotions ?? []).every((p) => p.decision === 'promoted'));
  const sessions = data.audit?.sessionRefs ?? [];
  check(`${label}: same coding-agent session resumed`, sessions.length === 1, `sessions=${sessions.length}`);
  check(
    `${label}: reviewer independent of coding agent`,
    data.audit?.identities?.reviewer && data.audit?.identities?.codingAgent && data.audit.identities.reviewer !== data.audit.identities.codingAgent,
  );
  const kinds = (data.events ?? []).map((e) => e.kind);
  const order = ['run.created', 'architect.blueprint_created', 'handoff.created', 'agent.report_created', 'verification.completed', 'reviewer.verdict_created', 'agent.session_resumed', 'audit.report_created', 'run.completed'];
  let cursor = -1;
  const ordered = order.every((k) => {
    const idx = kinds.indexOf(k, cursor + 1);
    if (idx === -1) return false;
    cursor = idx;
    return true;
  });
  check(`${label}: milestone event ordering stable`, ordered);
  const sequences = (data.events ?? []).map((e) => e.sequence);
  check(`${label}: event sequence monotonic`, sequences.every((v, i) => i === 0 || v > sequences[i - 1]));
  check(`${label}: no secret-shaped output`, !/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/.test(raw));
  return data;
}

console.log('RELAY YC DEMO VERIFICATION');
const statusBefore = gitStatus();
const first = runOnce('run 1');
const second = runOnce('run 2');
if (first && second) {
  const semantic = (d) => ({
    finalStatus: d.finalStatus, exitCode: d.exitCode, repairs: d.audit?.repairCount,
    outcome: d.audit?.outcome, promotions: (d.audit?.claimPromotions ?? []).length,
    eventKinds: (d.events ?? []).map((e) => e.kind),
  });
  check('repeated runs preserve semantic outcome', JSON.stringify(semantic(first)) === JSON.stringify(semantic(second)));
}
check('no repository modifications during runs', gitStatus() === statusBefore);
check('no provider environment consumed', !process.env.RELAY_TEST_FAKE_PROVIDER_CALL);

if (failures.length > 0) {
  console.log(`\nVERIFICATION FAILED: ${failures.length} check(s): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nVERIFICATION PASSED — the YC demo is recording-ready.');
