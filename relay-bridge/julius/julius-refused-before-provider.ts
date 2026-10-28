import {
  JULIUS_LIVE_STEP_NAME,
  JULIUS_MISSION_JOB_NAME,
  type JuliusWorkflowRunBinding,
} from '../../src/relay/mission/julius/julius-spend-ceiling';

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function sameRun(value: unknown, binding: JuliusWorkflowRunBinding): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && String(value) === binding.workflowRunId;
}
function sameAttempt(value: unknown, binding: JuliusWorkflowRunBinding): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && String(value) === binding.workflowRunAttempt;
}

export const JULIUS_TRUST_GATE_STEP_NAME = 'Gate: the code this job will run is reviewed, current and not rolled back';
/**
 * A generous ceiling for a refusal at the spend gate. With the transport retry on, a refusal can take four
 * 10 s connect timeouts plus 14 s of backoff. The bound is not what makes the proof safe: the log grammar
 * is (a real executed run's LIVE step lasted 6 s, so a short bound never separated the two).
 */
export const JULIUS_REFUSAL_MAX_LIVE_STEP_SECONDS = 300;

/**
 * Every refusal the entrypoint can print from its spend gate, which sits BEFORE the research policy,
 * the durable artifacts, any provider construction and any run row (`julius-live-mission.ts` :1050 to
 * :1062, the provider-facing code from :1133). `live_ledger_unbound` is printed just above it.
 */
export const JULIUS_PRE_PROVIDER_REFUSAL_CODES: readonly string[] = Object.freeze([
  'mission_spend_ceiling_unknown',
  'mission_repair_rounds_unknown',
  'mission_spend_ceiling_invalid',
  'namespace_spend_ceiling_exceeded',
  'mission_repair_rounds_invalid',
  'namespace_repair_ceiling_exceeded',
  'spend_ledger_unreadable',
  'qualifying_pair_spend_absent',
  'qualifying_pair_third_run_refused',
  'qualifying_pair_spend_unverified',
  'qualifying_pair_spend_exceeded',
  'live_ledger_unbound',
]);

/** The ONLY lines the entrypoint prints before its spend gate answers. Anything else is not this proof. */
const PRE_PROVIDER_OUTPUT: readonly RegExp[] = [
  /^JULIUS LIVE MISSION — preflight$/u,
  /^ {2}mission: mission:[a-z0-9-]{1,64} \(project [a-z0-9-]{1,64}\)$/u,
  /^ {2}requested models: architect=[A-Za-z0-9._/:-]{1,64} coder=[A-Za-z0-9._/:-]{1,64} reviewer=[A-Za-z0-9._/:-]{1,64}$/u,
  /^ {2}[A-Z][A-Z0-9_]{2,60}: (SET|MISSING)$/u,
  /^ {2}role credential: (Agentic Architect \(PROMPT_ARCHITECT\)|Coding Agent \(CODING_AGENT\)|Independent Reviewer \(INDEPENDENT_REVIEWER\)) provider=[a-z]{1,16} key=[A-Z][A-Z0-9_]{2,60} expected_org=(n\/a|[A-Z][A-Z0-9_]{2,60}) model=[A-Z][A-Z0-9_]{2,60}$/u,
  /^ {2}note: the local Hermes reviewer bills through the hermes profile of this operator account; XAI_API_KEY presence is reported for the record\.$/u,
  /^ {2}CLAUDE AUTH: API KEY provider=ANTHROPIC execution=CLAUDE_AGENT_SDK plan=n\/a api_key_used=true api_cost_applicable=true$/u,
  /^ {2}claude auth source: [a-z_]{1,40}$/u,
  /^ {2}billing paths: architect=[A-Z_]{1,24} coder=[A-Z_]{1,24} reviewer=[A-Z_]{1,24}$/u,
  /^ {2}live_ledger: (BOUND|UNBOUND)$/u,
  /^prior_run run=\S{1,80} workflow_run_id=[0-9]{1,20} attempt=[0-9]{1,10} classification=(NOT_EXECUTED|UNKNOWN|EXECUTED_CHARGES_KNOWN) basis=[a-z_]{1,64} counted=(true|false) reserved_usd_micros=([0-9]{1,15}|UNKNOWN) known_charges_usd_micros=([0-9]{1,15}|UNKNOWN)$/u,
  /^prior_runs ledger=(UNREADABLE counted=UNKNOWN|READABLE counted=[0-9]{1,4} of=[0-9]{1,4})$/u,
  /^prior_runs unreadable_reason=[a-z0-9_]{1,24}$/u,
  /^ledger-retry: attempt [1-3] reason=(transport|http_502|http_503|http_504)$/u,
];
const PRE_PROVIDER_RESULT = new RegExp(`^RESULT: BLOCKED — (${JULIUS_PRE_PROVIDER_REFUSAL_CODES.join('|')}): [^\\r\\n]{1,400}$`, 'u');
const LOG_STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{1,7}Z /u;

function logLine(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\u001b\[[0-9;]*m/gu, '').replace(/^\uFEFF/u, '').replace(/\r$/u, '').replace(LOG_STAMP, '');
}

/**
 * PROOF (c): THE RUN'S OWN RECORD SHOWS IT REFUSED BEFORE ANY PROVIDER.
 *
 * Used only where the evidence bundle is absent. True only when ALL hold, each read from GitHub for exactly
 * this run, attempt and head: the jobs API shows the one mission job completed with conclusion failure on a
 * `julius-paid` runner whose only label is `julius-paid`; the trust-gate step succeeded (so the head is a
 * reviewed, current main); the LIVE step failed within {@link JULIUS_REFUSAL_MAX_LIVE_STEP_SECONDS}; and the
 * LIVE step's log is exactly the entrypoint's preflight block followed by ONE `RESULT: BLOCKED — <closed
 * code>` line, then `julius_exit=1` and the shell's own exit line, with no other line anywhere between. A log
 * that shows a run row, a task, a response or any line this grammar does not name is not this proof.
 */
export function juliusLiveRefusedBeforeProvider(input: {
  readonly run: unknown;
  readonly jobs: unknown;
  readonly log: string | null;
  readonly binding: JuliusWorkflowRunBinding;
}): boolean {
  const { jobs: jobsBody, log, binding } = input;
  if (log === null || typeof log !== 'string') return false;
  // The run itself: a manual dispatch of the reviewed main workflow, on this head, finished.
  const runBody = objectOf(input.run);
  if (runBody === null || !sameRun(runBody.id, binding) || runBody.head_sha !== binding.headSha
    || runBody.head_branch !== 'main' || runBody.event !== 'workflow_dispatch' || runBody.status !== 'completed') return false;
  const body = objectOf(jobsBody);
  if (body === null || !Array.isArray(body.jobs) || body.total_count !== body.jobs.length) return false;
  const jobs = body.jobs.map(objectOf);
  if (jobs.some((job) => job === null)) return false;
  for (const job of jobs as Record<string, unknown>[]) {
    if (!sameRun(job.run_id, binding) || !sameAttempt(job.run_attempt, binding) || job.head_sha !== binding.headSha) return false;
  }
  const mission = (jobs as Record<string, unknown>[]).filter((job) => job.name === JULIUS_MISSION_JOB_NAME);
  if (mission.length !== 1) return false;
  const job = mission[0] as Record<string, unknown>;
  if (job.status !== 'completed' || job.conclusion !== 'failure' || !Array.isArray(job.steps)) return false;
  if (typeof job.runner_name !== 'string' || !/^julius-paid-[A-Za-z0-9_.-]{1,60}$/u.test(job.runner_name)) return false;
  if (!Array.isArray(job.labels) || job.labels.length !== 1 || job.labels[0] !== 'julius-paid') return false;
  const steps = job.steps.map(objectOf);
  if (steps.some((step) => step === null)) return false;
  const named = (name: string): Record<string, unknown> | null => {
    const hits = (steps as Record<string, unknown>[]).filter((step) => step.name === name);
    return hits.length === 1 ? (hits[0] as Record<string, unknown>) : null;
  };
  const gate = named(JULIUS_TRUST_GATE_STEP_NAME);
  if (gate === null || gate.status !== 'completed' || gate.conclusion !== 'success') return false;
  const live = named(JULIUS_LIVE_STEP_NAME);
  if (live === null || live.status !== 'completed' || live.conclusion !== 'failure') return false;
  const began = typeof live.started_at === 'string' ? Date.parse(live.started_at) : Number.NaN;
  const ended = typeof live.completed_at === 'string' ? Date.parse(live.completed_at) : Number.NaN;
  if (!Number.isFinite(began) || !Number.isFinite(ended) || ended < began || (ended - began) / 1000 > JULIUS_REFUSAL_MAX_LIVE_STEP_SECONDS) return false;

  const lines = log.split('\n').map(logLine);
  const commands = lines.map((line, index) => (line === 'node dist-relay-bridge/julius-live-mission.cjs \\' ? index : -1)).filter((index) => index >= 0);
  if (commands.length !== 1) return false;
  const opened = lines.findIndex((line, index) => index > (commands[0] as number) && line === '##[endgroup]');
  if (opened < 0) return false;
  const exitAt = lines.findIndex((line, index) => index > opened && /^julius_exit=[0-9]+$/u.test(line));
  if (exitAt < 0 || lines[exitAt] !== 'julius_exit=1') return false;
  const output = lines.slice(opened + 1, exitAt).filter((line) => line !== '');
  if (output.length < 2 || output[0] !== 'JULIUS LIVE MISSION — preflight') return false;
  const last = output[output.length - 1] as string;
  if (!PRE_PROVIDER_RESULT.test(last)) return false;
  for (const line of output.slice(0, -1)) {
    if (!PRE_PROVIDER_OUTPUT.some((allowed) => allowed.test(line))) return false;
  }
  // The step's own record ends at the shell's exit line; what follows belongs to the next step.
  const next = lines.slice(exitAt + 1).find((line) => line !== '');
  return next === '##[error]Process completed with exit code 1.';
}

