import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — the archive script is exercised for its digest only.
import { bundleDigest } from '../scripts/julius-paid-run-archive.mjs';
import { deriveJuliusSpentTag } from '../scripts/julius-admission-run-id.mjs';
import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
import {
  checkerVerdictFrom,
  createJuliusMissionEvidenceReader,
  J1_GRADE_COMBINED_PIN_SHA256,
  parseJuliusRunResultRecord,
  outcomeUnknownFrom,
  type JuliusMissionCompletionEvidence,
  type JuliusMissionGitHub,
  type JuliusMissionWorkflowRun,
} from './julius-mission-evidence-reader';
import { J1_PINNED_CHECKER_FILE_SHA256 } from './julius-inworld-checker';
import { acceptJuliusOutcomeUnknown, JULIUS_OUTCOME_UNKNOWN_CAUSES } from './julius-mission-evidence';
import { acceptJuliusMissionEvidence } from './julius-mission-evidence';
import { cachedEvidenceReader } from './wonderland-live-wiring';

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const LEGACY = 'run:0123456789abcdef01234567';
const SHA = 'a'.repeat(40);
const RUN = '4242';
const ATTEMPT = '1';
const TRACE = juliusMissionTraceId(WLJ);

function tagMessage(run: string, extra = ''): string {
  return [
    'julius-run-spent.v1',
    `run=${run}`,
    'namespace=julius-first-live',
    'reservedUsdMicros=5000000',
    `workflow_run_id=${RUN}`,
    `workflow_run_attempt=${ATTEMPT}`,
    `head_sha=${SHA}`,
    extra,
  ].filter((line) => line !== '').join('\n') + '\n';
}

function github(message: string | null, run: JuliusMissionWorkflowRun | null | 'throw-run' | 'throw-tag'): JuliusMissionGitHub & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async readAnnotatedTagMessage(tagRef) {
      calls.push(`tag ${tagRef}`);
      if (run === 'throw-tag') throw new Error('tag unread');
      return message;
    },
    async readWorkflowRun(workflowRunId, workflowRunAttempt) {
      calls.push(`run ${workflowRunId} ${workflowRunAttempt}`);
      if (run === 'throw-run' || run === 'throw-tag') throw new Error('run unread');
      return run;
    },
  };
}

const CREATED = '2026-10-24T12:58:41Z';

function workflow(overrides: Partial<JuliusMissionWorkflowRun> = {}): JuliusMissionWorkflowRun {
  return {
    workflowRunId: RUN,
    workflowRunAttempt: ATTEMPT,
    headSha: SHA,
    createdAt: CREATED,
    status: 'completed',
    conclusion: 'success',
    failedSteps: [],
    artifacts: [],
    ...overrides,
  };
}

const MARKER = [
  'completed_at=2026-10-24T13:00:00Z',
  `run_id=${RUN}`,
  `commit=${SHA}`,
  'workflow_ref=unknown',
  '',
].join('\n');

const RESULT = `RESULT: COMPLETED after 2 ticks\n  run: ${WLJ}\n`;

/** psql -A -F $'\t' header of slot-events.tsv, alias order of the dump. */
const SLOT_COLUMNS = [
  'run_id', 'sequence', 'event_id', 'event_type', 'task_id', 'worker_id', 'role',
  'cost_basis', 'usd_micros', 'reservation_id', 'failure_class', 'provider', 'provider_id',
  'requested_model', 'served_model', 'stage', 'attempt', 'occurred_at',
] as const;

function slotCells(overrides: Partial<Record<(typeof SLOT_COLUMNS)[number], string>>): string[] {
  return SLOT_COLUMNS.map((column) => overrides[column] ?? (column === 'run_id' ? WLJ : ''));
}

function slotEvents(rows: readonly (readonly string[])[]): string {
  const footer = `(${rows.length} ${rows.length === 1 ? 'row' : 'rows'})`;
  return [SLOT_COLUMNS.join('\t'), ...rows.map((row) => row.join('\t')), footer, ''].join('\n');
}

function runsTsv(revision: string): string {
  return [
    'run_id\tmission_id\tstate\tcard_revision\tcreated_at\tupdated_at\tproject_brain_revision',
    `${WLJ}\tmission:julius-continuous-1\tCOMPLETED\tcard-r1\t2026-10-24 12:00:00+00\t2026-10-24 13:00:00+00\t${revision}`,
    '(1 row)',
    '',
  ].join('\n');
}

function withProof(files: readonly { path: string; text: string }[], overrides: Partial<JuliusMissionWorkflowRun> = {}): JuliusMissionWorkflowRun {
  return workflow({
    ...overrides,
    artifacts: [
      { name: 'julius-live-evidence', files },
      { name: 'julius-first-live-completed', files: [{ path: 'marker.txt', text: MARKER }] },
    ],
  });
}

describe('JuliusMissionEvidenceReader', () => {
  it('returns null and does not call GitHub for an id that is not wlj_', async () => {
    const source = github(null, null);
    const reader = createJuliusMissionEvidenceReader(source);
    for (const id of ['preflight:abc', '', 'not-an-id', 'wlj_01234567-89ab-1cde-8fab-0123456789ab', LEGACY]) {
      expect(await reader.read(id), id).toBeNull();
    }
    expect(source.calls).toEqual([]);
  });

  it('returns null when the spend tag is absent, malformed, or names another run', async () => {
    const derived = deriveJuliusSpentTag(WLJ);
    expect(derived.ok && derived.tag).toBe('refs/tags/julius-run-spent-0123456789ab4cde8fab0123456789ab');
    const absent = github(null, workflow());
    expect(await createJuliusMissionEvidenceReader(absent).read(WLJ)).toBeNull();
    expect(absent.calls).toEqual([`tag ${derived.ok ? derived.tag : ''}`]);

    const malformed = github(`${tagMessage(WLJ)}forged=1\n`, workflow());
    expect(await createJuliusMissionEvidenceReader(malformed).read(WLJ)).toBeNull();
    expect(malformed.calls.some((call) => call.startsWith('run '))).toBe(false);

    const other = github(tagMessage('wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d'), workflow());
    expect(await createJuliusMissionEvidenceReader(other).read(WLJ)).toBeNull();
    expect(other.calls.some((call) => call.startsWith('run '))).toBe(false);
  });

  it('returns null when the tagged workflow run cannot be read or does not match', async () => {
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), 'throw-run')).read(WLJ)).toBeNull();
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), 'throw-tag')).read(WLJ)).toBeNull();
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({ headSha: 'b'.repeat(40) }))).read(WLJ)).toBeNull();
  });

  it('returns null while the matched run is queued or in progress', async () => {
    const running = github(tagMessage(WLJ), workflow({ status: 'in_progress', conclusion: null }));
    expect(await createJuliusMissionEvidenceReader(running).read(WLJ)).toBeNull();
    expect(running.calls.some((call) => call.startsWith('run '))).toBe(true);
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({ status: 'queued', conclusion: null }))).read(WLJ)).toBeNull();
  });

  it('returns the completion object only when the workflow, the marker, and the RESULT line agree', async () => {
    const reviewerRequest = 'req_reviewer_0123456789';
    const messageId = 'msg_should_not_appear';
    const diagnostics = [
      'run_id\trole\tstage\tdispatch_attempt\tprovider_request_id\tresponse_id\tprovider_message_id\tprovider_request_availability\tprovider_request_unavailable_reason\tcost_usd_micros\tcost_basis\texecution_cost_usd_micros\tbilling_path\ttrace_id\tspan_id',
      `${WLJ}\tCODING_AGENT\tbuild\t1\treq_0123456789abcdef\tresp_0123456789abcdef\t${messageId}\tCAPTURED\t\t1200\tPROVIDER_REPORTED\t1200\tAPI_BILLED\tffffffffffffffffffffffffffffffff\taaaaaaaaaaaaaaaa`,
      `${WLJ}\tPROMPT_ARCHITECT\tplan\t1\t\t\t\t\t\t\t\t\t\t\t`,
      `${WLJ}\tINDEPENDENT_REVIEWER\trepair:plan\t1\t${reviewerRequest}\t\t\tCAPTURED\t\t\t\t\t\t\t`,
      '(3 rows)',
    ].join('\n');
    const evidence = [
      'run_id\tartifact_ref',
      `${WLJ}\tartifact:julius-work-artifact.v1:plan`,
      '(1 row)',
    ].join('\n');
    const costs = [
      'run_id\trole\tcomponents\tknown_usd_micros\testimated_usd_micros\tunknown_components\testimated_components\tunsettled_components',
      `${WLJ}\tCODING_AGENT\t1\t1200\t0\t0\t0\t0`,
      '(1 row)',
    ].join('\n');
    const runs = `run_id\tmission_id\tstate\tcard_revision\n${WLJ}\tmission:julius-continuous-1\tCOMPLETED\t7\n(1 row)\n`;
    const files = [
      { path: 'cost-accounting.tsv', text: costs },
      { path: 'evidence.tsv', text: evidence },
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'runs.tsv', text: runs },
      { path: 'worker-diagnostics.tsv', text: diagnostics },
    ];
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof(files))).read(WLJ);
    const digested = files.map((file) => ({
      path: file.path,
      sha256: createHash('sha256').update(file.text).digest('hex'),
      kind: file.path.endsWith('.tsv') ? 'table' : 'text',
    }));

    expect(reading).toEqual({
      juliusFinalState: 'COMPLETED',
      spendTag: {
        schema: 'julius-run-spent.v1',
        run: WLJ,
        namespace: 'julius-first-live',
        reservedUsdMicros: 5_000_000,
        workflowRunId: RUN,
        workflowRunAttempt: ATTEMPT,
        headSha: SHA,
        workflowRunCreatedAt: CREATED,
      },
      spendAccounting: null,
      coderCost: {
        costUsdMicros: 1200,
        costBasis: 'PROVIDER_REPORTED',
        executionCostUsdMicros: 1200,
        billingPath: 'API_BILLED',
      },
      missionCost: { knownUsdMicros: 1200, unknownComponents: 0, complete: true },
      providerReceipt: {
        providerRequestId: 'req_0123456789abcdef',
        responseId: 'resp_0123456789abcdef',
        providerRequestAvailability: 'CAPTURED',
        providerRequestUnavailableReason: null,
      },
      archive: {
        artifactName: 'julius-live-evidence',
        artifactDigest: bundleDigest([...digested].sort((a, b) => a.path.localeCompare(b.path))),
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0),
        conclusion: 'success',
        failedSteps: [],
        files: digested,
      },
      workArtifactRefs: ['artifact:julius-work-artifact.v1:plan'],
      projectBrainRevision: null,
      phases: null,
      traceId: TRACE,
      traceparent: null,
      checkerVerdict: 'NOT_RUN',
      checker: null,
    });
    const json = JSON.stringify(reading);
    expect(json).not.toContain('ffffffffffffffffffffffffffffffff');
    expect(json).not.toContain('"spanId"');
    expect(json).not.toContain(messageId);
    expect(json).not.toContain(reviewerRequest);
    expect(json).not.toContain('providerMessageId');
    expect(TRACE).toBe('192b1fbb866790da0ba590b4a8f45144');
  });

  it('does not promote the dump tables into slot state, a verified spend cap, or the run brain revision', async () => {
    // A bundle with no slot-events.tsv, and a runs.tsv header that stops at updated_at,
    // still leaves the three fields null. tasks.tsv state ACTIVE is a JuliusTaskState.
    // project-brain.tsv revision is the entry's revision. budget.tsv and
    // cost-accounting.tsv are the ledger and missionCost. worker-diagnostics.tsv
    // stage and dispatch_attempt are not a slot projection.
    const tasks = [
      'task_id\ttask_type\trole\tstate\tordinal\tparent_task_id\trun_id\tlease_generation',
      `plan:${WLJ}\tplan\tPROMPT_ARCHITECT\tSUCCEEDED\t0\t\t${WLJ}\t1`,
      `build:${WLJ}\tbuild\tCODING_AGENT\tACTIVE\t1\tplan:${WLJ}\t${WLJ}\t1`,
      `repair:${WLJ}\trepair:build\tCODING_AGENT\tRUNNABLE\t2\tbuild:${WLJ}\t${WLJ}\t2`,
      `review:${WLJ}\treview:build\tINDEPENDENT_REVIEWER\tBLOCKED\t3\tbuild:${WLJ}\t${WLJ}\t1`,
      '(4 rows)',
      '',
    ].join('\n');
    const brain = [
      'entry_id\tentry_kind\tworker_id\ttask_id\trevision\tcreated_at\trun_id',
      `entry-1\tDECISION\tarchitect\tplan:${WLJ}\t1\t2026-10-24 13:00:00+00\t${WLJ}`,
      `entry-2\tHANDOFF\tcoder\tbuild:${WLJ}\t7\t2026-10-24 13:01:00+00\t${WLJ}`,
      '(2 rows)',
      '',
    ].join('\n');
    const runs = [
      'run_id\tmission_id\tstate\tcard_revision\tcreated_at\tupdated_at',
      `${WLJ}\tmission:julius-continuous-1\tCOMPLETED\tcard-r1\t2026-10-24 12:00:00+00\t2026-10-24 13:00:00+00`,
      '(1 row)',
      '',
    ].join('\n');
    const budget = [
      'run_id\tsequence\ttask_id\tevent_type\trole\tallocated_usd_micros\tallocation_basis\tshare_usd_micros\tremaining_usd_micros\tallocation_policy\tsettled_usd_micros\tcost_basis\testimated_usd_micros\tbilling_path\texecution_usd_micros\treason\tslot_refusal\treservation_id\toccurred_at',
      `${WLJ}\t4\tbuild:${WLJ}\tjulius.budget.settled\tCODING_AGENT\t\t\t\t\t\t1200\tPROVIDER_REPORTED\t\tAPI_BILLED\t\t\t\tres-1\t2026-10-24 13:00:00+00`,
      '(1 row)',
      '',
    ].join('\n');
    const costs = [
      'run_id\trole\tcomponents\tknown_usd_micros\testimated_usd_micros\tunknown_components\testimated_components\tunsettled_components',
      `${WLJ}\tCODING_AGENT\t1\t1200\t0\t0\t0\t0`,
      '(1 row)',
      '',
    ].join('\n');
    const diagnostics = [
      'run_id\trole\tstage\tdispatch_attempt\tevent_type',
      `${WLJ}\tPROMPT_ARCHITECT\tplan\t1\tjulius.worker.completed`,
      `${WLJ}\tCODING_AGENT\tbuild\t1\tjulius.worker.completed`,
      `${WLJ}\tCODING_AGENT\trepair:build\t2\tjulius.task.failed`,
      `${WLJ}\tINDEPENDENT_REVIEWER\trepair:plan\t1\tjulius.worker.completed`,
      '(4 rows)',
      '',
    ].join('\n');
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'tasks.tsv', text: tasks },
      { path: 'project-brain.tsv', text: brain },
      { path: 'runs.tsv', text: runs },
      { path: 'budget.tsv', text: budget },
      { path: 'cost-accounting.tsv', text: costs },
      { path: 'worker-diagnostics.tsv', text: diagnostics },
    ]))).read(WLJ);
    expect(reading).toMatchObject({
      juliusFinalState: 'COMPLETED',
      spendAccounting: null,
      missionCost: { knownUsdMicros: 1200, unknownComponents: 0, complete: true },
      projectBrainRevision: null,
      phases: null,
    });
    const json = JSON.stringify(reading);
    expect(json).not.toContain('NEVER_DISPATCHED');
    expect(json).not.toContain('spendVerified');
    expect(json).not.toContain('unverifiableApiSpend');
    expect(json).not.toContain('"projectBrainRevision":7');
    expect(json).not.toContain('"state":"ACTIVE"');
  });

  it('does not invent a cost or a phase list the bundle does not carry', async () => {
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
    ]))).read(WLJ);
    expect(reading).toMatchObject({
      juliusFinalState: 'COMPLETED',
      spendAccounting: null,
      coderCost: null,
      missionCost: null,
      providerReceipt: null,
      workArtifactRefs: null,
      projectBrainRevision: null,
      phases: null,
      traceId: TRACE,
      traceparent: null,
    });
    expect(JSON.stringify(reading)).not.toContain('"knownUsdMicros":0');
  });

  it('returns null for a failed run and for a marker that disagrees with the conclusion', async () => {
    const failed = `RESULT: FAILED after 1 ticks\n  run: ${WLJ}\n`;
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      conclusion: 'failure',
      failedSteps: ['first-live-mission: Run the live mission'],
      artifacts: [{ name: 'julius-live-evidence', files: [{ path: 'live-mission.evidence.txt', text: failed }] }],
    }))).read(WLJ)).toBeNull();

    const marker = `completed_at=2026-10-24T13:00:00Z\nrun_id=${RUN}\ncommit=${SHA}\nworkflow_ref=unknown\n`;
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), workflow({
      conclusion: 'failure',
      failedSteps: ['first-live-mission: Run the live mission'],
      artifacts: [
        { name: 'julius-live-evidence', files: [{ path: 'live-mission.evidence.txt', text: RESULT }] },
        { name: 'julius-first-live-completed', files: [{ path: 'marker.txt', text: marker }] },
      ],
    }))).read(WLJ)).toBeNull();
  });

  it('drops a credential-shaped request id and does not count it captured', async () => {
    const secret = ['sk', 'ant', 'A'.repeat(24)].join('-');
    const diagnostics = [
      'run_id\trole\tprovider_request_id\tprovider_request_availability',
      `${WLJ}\tCODING_AGENT\t${secret}\tCAPTURED`,
      '(1 row)',
    ].join('\n');
    const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'worker-diagnostics.tsv', text: diagnostics },
    ]))).read(WLJ);
    expect(reading).toMatchObject({
      providerReceipt: {
        providerRequestId: null,
        responseId: null,
        providerRequestAvailability: 'UNAVAILABLE',
        providerRequestUnavailableReason: 'provider_request_id_credential_shaped',
      },
    });
    expect(JSON.stringify(reading)).not.toContain(secret);
  });

  it('reads phases from the ledger dump and the run counter from runs.tsv', async () => {
    const task = `build:${WLJ}`;
    // File order is not ledger order. The settlement and the repair stage sit
    // above the row that states the role, which is how a dispatch's predecessor
    // is lost when the reader sorts by the wall clock or by file order.
    const slots = slotEvents([
      slotCells({ sequence: '5', event_id: 'e5', event_type: 'julius.worker.completed', task_id: task, stage: 'repair:build', attempt: '2', occurred_at: '2026-10-24 13:00:05+00' }),
      slotCells({ sequence: '4', event_id: 'e4', event_type: 'julius.budget.settled', task_id: task, cost_basis: 'PROVIDER_REPORTED', usd_micros: '1000', reservation_id: 'res-1', occurred_at: '2026-10-24 13:00:04+00' }),
      slotCells({ sequence: '6', event_id: 'e6', event_type: 'julius.worker.completed', task_id: task, stage: 'checkpoint', occurred_at: '2026-10-24 13:00:06+00' }),
      slotCells({ sequence: '1', event_id: 'e1', event_type: 'julius.budget.reserved', task_id: task, role: 'CODING_AGENT', stage: 'plan', attempt: '1', reservation_id: 'res-1', occurred_at: '2026-10-24 13:00:01+00' }),
      slotCells({ sequence: '8', event_id: 'e8', event_type: 'julius.worker.completed', task_id: task, stage: 'deliver', occurred_at: '2026-10-24 13:00:08+00' }),
      slotCells({ sequence: '2', event_id: 'e2', event_type: 'julius.worker.dispatched', task_id: task, worker_id: 'w-coder', reservation_id: 'res-1', occurred_at: '2026-10-24 13:00:02+00' }),
      slotCells({ sequence: '7', event_id: 'e7', event_type: 'julius.worker.completed', task_id: task, stage: 'guidance', occurred_at: '2026-10-24 13:00:07+00' }),
      slotCells({ sequence: '3', event_id: 'e3', event_type: 'julius.worker.completed', task_id: task, stage: 'build', attempt: '1', occurred_at: '2026-10-24 13:00:03+00' }),
      slotCells({ sequence: '9', event_id: 'e9', event_type: 'julius.worker.completed', task_id: task, stage: 'issue', occurred_at: '2026-10-24 13:00:09+00' }),
      slotCells({ run_id: 'other-run', sequence: '1', event_id: 'ox', event_type: 'julius.budget.settled', usd_micros: 'nope' }),
    ]);
    const coder = {
      role: 'CODING_AGENT',
      state: 'IDLE',
      stage: 'repair:build',
      attempt: 2,
      spanId: null,
      traceparent: null,
      knownUsdMicros: 1000,
      costComplete: true,
    };
    const absent = {
      state: 'NEVER_DISPATCHED',
      stage: null,
      attempt: null,
      spanId: null,
      traceparent: null,
      knownUsdMicros: 0,
      costComplete: true,
    };
    const readAt = async (revision: string) => createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'runs.tsv', text: runsTsv(revision) },
      { path: 'slot-events.tsv', text: slots },
    ]))).read(WLJ);
    const atZero = await readAt('0');
    expect(atZero).toMatchObject({
      juliusFinalState: 'COMPLETED',
      spendAccounting: null,
      projectBrainRevision: 0,
      phases: [
        { role: 'PROMPT_ARCHITECT', ...absent },
        coder,
        { role: 'INDEPENDENT_REVIEWER', ...absent },
      ],
    });
    expect(await readAt('4')).toMatchObject({ projectBrainRevision: 4, spendAccounting: null });
    const json = JSON.stringify(atZero);
    expect(json).not.toContain('spendVerified');
    expect(json).not.toContain('unverifiableApiSpend');
    expect(json).toContain('"spanId":null');
    expect(json).not.toContain('"spanId":"');
  });

  it('treats an empty slot ledger as three never-dispatched phases and a missing one as null', async () => {
    const empty = slotEvents([]);
    const headerOnly = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'runs.tsv', text: runsTsv('0') },
      { path: 'slot-events.tsv', text: empty },
    ]))).read(WLJ);
    expect(headerOnly).toMatchObject({
      juliusFinalState: 'COMPLETED',
      projectBrainRevision: 0,
      phases: [
        { role: 'PROMPT_ARCHITECT', state: 'NEVER_DISPATCHED', knownUsdMicros: 0, costComplete: true, stage: null, attempt: null },
        { role: 'CODING_AGENT', state: 'NEVER_DISPATCHED', knownUsdMicros: 0, costComplete: true, stage: null, attempt: null },
        { role: 'INDEPENDENT_REVIEWER', state: 'NEVER_DISPATCHED', knownUsdMicros: 0, costComplete: true, stage: null, attempt: null },
      ],
    });
    for (const text of ['unavailable\n', null]) {
      const files = [
        { path: 'live-mission.evidence.txt', text: RESULT },
        { path: 'runs.tsv', text: runsTsv('4') },
        ...(text === null ? [] : [{ path: 'slot-events.tsv', text }]),
      ];
      const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof(files))).read(WLJ);
      expect(reading, text ?? 'missing').toMatchObject({
        juliusFinalState: 'COMPLETED',
        projectBrainRevision: 4,
        phases: null,
        spendAccounting: null,
      });
    }
  });

  it('nulls phases on a drifted or malformed slot file and still returns the completion', async () => {
    const task = `build:${WLJ}`;
    const sound = [
      slotCells({ sequence: '1', event_id: 'e1', event_type: 'julius.budget.reserved', task_id: task, role: 'CODING_AGENT', stage: 'build', attempt: '1' }),
      slotCells({ sequence: '2', event_id: 'e2', event_type: 'julius.worker.dispatched', task_id: task, reservation_id: 'res-1' }),
    ];
    const cases: Array<{ name: string; text: string }> = [
      { name: 'duplicate sequence', text: slotEvents([...sound, slotCells({ sequence: '2', event_id: 'e3', event_type: 'julius.worker.completed', task_id: task, stage: 'build' })]) },
      { name: 'usd', text: slotEvents([...sound, slotCells({ sequence: '3', event_id: 'e3', event_type: 'julius.budget.settled', task_id: task, usd_micros: '12x', cost_basis: 'PROVIDER_REPORTED' })]) },
      { name: 'attempt', text: slotEvents([...sound, slotCells({ sequence: '3', event_id: 'e3', event_type: 'julius.worker.completed', task_id: task, attempt: '1.5', stage: 'build' })]) },
      { name: 'sequence 0', text: slotEvents([slotCells({ sequence: '0', event_id: 'e0', event_type: 'julius.worker.dispatched', task_id: task, role: 'CODING_AGENT' })]) },
      {
        name: 'missing column',
        text: [
          SLOT_COLUMNS.filter((column) => column !== 'attempt').join('\t'),
          SLOT_COLUMNS.filter((column) => column !== 'attempt').map((column) => (column === 'run_id' ? WLJ : column === 'sequence' ? '1' : column === 'event_type' ? 'julius.worker.dispatched' : '')).join('\t'),
          '(1 row)',
          '',
        ].join('\n'),
      },
    ];
    for (const item of cases) {
      const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
        { path: 'live-mission.evidence.txt', text: RESULT },
        { path: 'runs.tsv', text: runsTsv('4') },
        { path: 'slot-events.tsv', text: item.text },
      ]))).read(WLJ);
      expect(reading, item.name).toMatchObject({
        juliusFinalState: 'COMPLETED',
        projectBrainRevision: 4,
        phases: null,
        spendAccounting: null,
      });
    }
  });

  it('leaves the run counter null when the cell is empty or not an integer', async () => {
    const slots = slotEvents([]);
    for (const revision of ['', 'nope']) {
      const reading = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
        { path: 'live-mission.evidence.txt', text: RESULT },
        { path: 'runs.tsv', text: runsTsv(revision) },
        { path: 'slot-events.tsv', text: slots },
      ]))).read(WLJ);
      expect(reading, revision === '' ? 'empty' : revision).toMatchObject({
        juliusFinalState: 'COMPLETED',
        projectBrainRevision: null,
        spendAccounting: null,
        phases: [
          { role: 'PROMPT_ARCHITECT', state: 'NEVER_DISPATCHED' },
          { role: 'CODING_AGENT', state: 'NEVER_DISPATCHED' },
          { role: 'INDEPENDENT_REVIEWER', state: 'NEVER_DISPATCHED' },
        ],
      });
    }
  });

  it('returns null when runs.tsv names a different state', async () => {
    const runs = `run_id\tstate\n${WLJ}\tFAILED\n(1 row)\n`;
    expect(await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withProof([
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'runs.tsv', text: runs },
    ]))).read(WLJ)).toBeNull();
  });

  it('carries the matched run\'s created_at into the spend tag, and is not completion without a well-formed one', async () => {
    const files = [
      { path: 'live-mission.evidence.txt', text: RESULT },
      { path: 'runs.tsv', text: `run_id\tstate\n${WLJ}\tCOMPLETED\n(1 row)\n` },
    ];
    const read = (createdAt: unknown) => createJuliusMissionEvidenceReader(github(tagMessage(WLJ),
      withProof(files, { createdAt } as Partial<JuliusMissionWorkflowRun>))).read(WLJ);

    const carried = await read('2026-10-25T09:30:05Z');
    expect((carried as JuliusMissionCompletionEvidence | null)?.spendTag.workflowRunCreatedAt).toBe('2026-10-25T09:30:05Z');

    for (const bad of [null, undefined, '', 1_761_384_605, '2026-10-25 09:30:05Z', '2026-10-25T09:30:05+00:00',
      '2026-10-25T09:30:05.123Z', '2026-10-25T09:30:05', '2026-13-45T99:99:99Z', ' 2026-10-25T09:30:05Z']) {
      expect(await read(bad), String(bad)).toBeNull();
    }
  });
});

describe('the hidden checker verdict is read from the grade job only', () => {
  const judged = 'b'.repeat(64);
  const TASK = 'task:build-1';
  const CONTEXT = 'context:9';
  const verdictFile = (verdict: string, opts: { runId?: string; checkerSha?: string; extra?: string } = {}): string => [
    'schema=julius-inworld-verdict.v1', `verdict=${verdict}`, 'reason=none', `run_id=${opts.runId ?? WLJ}`, `context_id=${CONTEXT}`, `task_id=${TASK}`, 'task_type=build',
    `judged_trimmed_sha256=${judged}`, `game_digest=${judged.slice(0, 12)}`, `checker_sha256=${opts.checkerSha ?? J1_PINNED_CHECKER_FILE_SHA256}`,
    'combined_pin=none', 'grader_sha256=none', 'failed_sections=none', opts.extra ?? '', '',
  ].join('\n');
  const published = (taskId: string, contextId: string): string | null => (taskId === TASK && contextId === CONTEXT ? judged : null);
  const redactedRecord = (sha = judged): string => JSON.stringify({ schema: 'julius-final-message.v2', taskId: TASK, contextId: CONTEXT, runId: WLJ, trimmedSha256: sha, trimmedUtf8Bytes: 2, text: '{}' });

  it('PASS and FAIL are kept verbatim with what was judged', () => {
    expect(checkerVerdictFrom(verdictFile('PASS'), WLJ, published)).toEqual({
      checkerVerdict: 'PASS',
      checker: { reason: 'none', taskId: TASK, judgedTrimmedSha256: judged, gameDigest: judged.slice(0, 12), checkerSha256: J1_PINNED_CHECKER_FILE_SHA256 },
    });
    expect(checkerVerdictFrom(verdictFile('FAIL'), WLJ, published).checkerVerdict).toBe('FAIL');
  });

  it('absent, another run, another schema, a duplicate key, or an unknown token is NOT_RUN, never PASS', () => {
    expect(checkerVerdictFrom(null, WLJ, published)).toEqual({ checkerVerdict: 'NOT_RUN', checker: null });
    expect(checkerVerdictFrom(verdictFile('PASS', { runId: 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d' }), WLJ, published).checkerVerdict).toBe('NOT_RUN');
    expect(checkerVerdictFrom(verdictFile('PASS').replace('julius-inworld-verdict.v1', 'v0'), WLJ, published).checkerVerdict).toBe('NOT_RUN');
    expect(checkerVerdictFrom(verdictFile('PASS', { extra: 'verdict=PASS' }), WLJ, published).checkerVerdict).toBe('NOT_RUN');
    expect(checkerVerdictFrom(verdictFile('pass'), WLJ, published).checkerVerdict).toBe('NOT_RUN');
    expect(checkerVerdictFrom(verdictFile('NOT_RUN'), WLJ, published).checkerVerdict).toBe('NOT_RUN');
  });

  it('a PASS that does not name the judged bytes is not a verdict', () => {
    expect(checkerVerdictFrom(verdictFile('PASS').replace(`judged_trimmed_sha256=${judged}`, 'judged_trimmed_sha256=none'), WLJ, published).checkerVerdict).toBe('NOT_RUN');
    expect(checkerVerdictFrom(verdictFile('PASS').replace(`game_digest=${judged.slice(0, 12)}`, 'game_digest=000000000000'), WLJ, published).checkerVerdict).toBe('NOT_RUN');
  });

  it('a PASS from an unpinned checker, or on bytes the run did not publish, is NOT_RUN', () => {
    expect(checkerVerdictFrom(verdictFile('PASS', { checkerSha: 'c'.repeat(64) }), WLJ, published).checkerVerdict).toBe('NOT_RUN');
    expect(checkerVerdictFrom(verdictFile('PASS'), WLJ, () => 'e'.repeat(64)).checkerVerdict).toBe('NOT_RUN');
    expect(checkerVerdictFrom(verdictFile('PASS'), WLJ).checkerVerdict).toBe('NOT_RUN');
  });

  it('a completed run carries the grade job\'s verdict, and a verdict inside julius-live-evidence is not read', async () => {
    const runs = `run_id\tmission_id\tstate\tcard_revision\n${WLJ}\tmission:julius-continuous-1\tCOMPLETED\t7\n(1 row)\n`;
    const files = [
      { path: 'live-mission.evidence.txt', text: RESULT }, { path: 'runs.tsv', text: runs },
      { path: 'final-message/task_build-1.context_9.redacted.json', text: redactedRecord() },
    ];
    const graded = withProof(files);
    const withVerdict = { ...graded, artifacts: [...graded.artifacts, { name: 'julius-inworld-verdict', files: [{ path: 'checker-verdict.txt', text: verdictFile('FAIL') }] }] };
    const failed = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), withVerdict)).read(WLJ) as { checkerVerdict: string } | null;
    expect(failed?.checkerVerdict).toBe('FAIL');

    const tampered = withProof([...files.slice(0, 2), { path: 'final-message/task_build-1.context_9.redacted.json', text: redactedRecord('e'.repeat(64)) }]);
    const tamperedWithVerdict = { ...tampered, artifacts: [...tampered.artifacts, { name: 'julius-inworld-verdict', files: [{ path: 'checker-verdict.txt', text: verdictFile('PASS') }] }] };
    const mismatch = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), tamperedWithVerdict)).read(WLJ) as { checkerVerdict: string } | null;
    expect(mismatch?.checkerVerdict).toBe('NOT_RUN');

    const smuggled = withProof([...files, { path: 'checker-verdict.txt', text: verdictFile('PASS') }]);
    const notRun = await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), smuggled)).read(WLJ) as { checkerVerdict: string } | null;
    expect(notRun?.checkerVerdict).toBe('NOT_RUN');
  });

  it('#51: a run the grade job failed is read, and is the outcome only when its verdict is FAIL', async () => {
    const runs = `run_id\tmission_id\tstate\tcard_revision\n${WLJ}\tmission:julius-continuous-1\tCOMPLETED\t7\n(1 row)\n`;
    const files = [
      { path: 'live-mission.evidence.txt', text: RESULT }, { path: 'runs.tsv', text: runs },
      { path: 'final-message/task_build-1.context_9.redacted.json', text: redactedRecord() },
    ];
    const GRADE = 'J1: stage the pinned checker from git objects and grade';
    const run = (verdict: string | null, overrides: Partial<JuliusMissionWorkflowRun>) => {
      const base = withProof(files, overrides);
      return verdict === null ? base : { ...base, artifacts: [...base.artifacts, { name: 'julius-inworld-verdict', files: [{ path: 'checker-verdict.txt', text: verdictFile(verdict) }] }] };
    };
    const read = async (value: JuliusMissionWorkflowRun) => await createJuliusMissionEvidenceReader(github(tagMessage(WLJ), value)).read(WLJ) as { checkerVerdict: string } | null;
    const graded = { conclusion: 'failure' as const, failedSteps: [GRADE] };
    // FAIL: the run concluded failure because the grade did. It is reported.
    expect((await read(run('FAIL', graded)))?.checkerVerdict).toBe('FAIL');
    // PASS: unchanged, a successful run.
    expect((await read(run('PASS', {})))?.checkerVerdict).toBe('PASS');
    // A failed grade whose verdict is not FAIL (NOT_RUN, a PASS that failed anyway, or none) is not an outcome.
    expect(await read(run('NOT_RUN', graded))).toBeNull();
    expect(await read(run('PASS', graded))).toBeNull();
    expect(await read(run(null, graded))).toBeNull();
    // Any other failed step, alone or beside the grade, is not a graded failure.
    expect(await read(run('FAIL', { conclusion: 'failure', failedSteps: ['LIVE: run the first real Julius mission'] }))).toBeNull();
    expect(await read(run('FAIL', { conclusion: 'failure', failedSteps: [GRADE, 'J1: delete the graded final message'] }))).toBeNull();
    expect(await read(run('FAIL', { conclusion: 'failure', failedSteps: [] }))).toBeNull();
    // Cancelled, or not finished yet: no verdict yet.
    expect(await read(run('FAIL', { conclusion: 'cancelled', failedSteps: [GRADE] }))).toBeNull();
    expect(await read(run('FAIL', { status: 'in_progress', conclusion: null, failedSteps: [GRADE] }))).toBeNull();
  });
});

describe('the reader\'s inlined checker pin', () => {
  it('equals the runtime pin, so a re-pinned checker cannot be read past', async () => {
    const source = (await import('node:fs')).readFileSync('relay-bridge/julius-mission-evidence-reader.ts', 'utf8');
    expect(source).toContain(`const J1_PINNED_CHECKER_FILE_SHA256 = '${J1_PINNED_CHECKER_FILE_SHA256}';`);
  });
});

describe('an ambiguous provider outcome is read from the run\'s own failure record', () => {
  /** psql -A -F $'\t' header of failures.tsv, alias order of the dump. */
  const FAILURE_COLUMNS = ['run_id', 'sequence', 'task_id', 'role', 'event_type', 'julius_code', 'failure_class', 'error_retryable', 'reason_code', 'recovery_action', 'occurred_at'] as const;
  const failures = (rows: readonly Partial<Record<(typeof FAILURE_COLUMNS)[number], string>>[]) => [
    FAILURE_COLUMNS.join('\t'),
    ...rows.map((row) => FAILURE_COLUMNS.map((column) => row[column] ?? (column === 'run_id' ? WLJ : '')).join('\t')),
    `(${rows.length} ${rows.length === 1 ? 'row' : 'rows'})`,
    '',
  ].join('\n');
  const HANDED = { sequence: '41', task_id: 'task:build:1', role: 'CODING_AGENT', event_type: 'julius.recovery.action', reason_code: 'HANDED_OUTCOME_UNKNOWN', recovery_action: 'FAIL_TASK' };
  const failedRun = (text: string, overrides: Partial<JuliusMissionWorkflowRun> = {}) => workflow({
    conclusion: 'failure',
    ...overrides,
    artifacts: [{ name: 'julius-live-evidence', files: [{ path: 'failures.tsv', text }] }],
  });

  it('the recovery sweep\'s FAIL_TASK HANDED_OUTCOME_UNKNOWN is the outcome, with its task and role', () => {
    expect(outcomeUnknownFrom(failures([{ sequence: '3', event_type: 'julius.retry.scheduled', julius_code: 'TIMEOUT' }, HANDED]), WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES))
      .toEqual({ cause: 'HANDED_OUTCOME_UNKNOWN', role: 'CODING_AGENT', taskId: 'task:build:1' });
  });

  it('a requeue, another run, an unlisted cause, another event or a malformed table is not one', () => {
    expect(outcomeUnknownFrom(failures([{ ...HANDED, recovery_action: 'REQUEUE' }]), WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES)).toBeNull();
    expect(outcomeUnknownFrom(failures([{ ...HANDED, run_id: 'wlj_other' }]), WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES)).toBeNull();
    expect(outcomeUnknownFrom(failures([{ ...HANDED, reason_code: 'LEASE_EXPIRED' }]), WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES)).toBeNull();
    expect(outcomeUnknownFrom(failures([{ ...HANDED, event_type: 'julius.retry.scheduled' }]), WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES)).toBeNull();
    expect(outcomeUnknownFrom('run_id\tsequence\nbroken', WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES)).toBeNull();
    expect(outcomeUnknownFrom(null, WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES)).toBeNull();
  });

  it('#43: a task.failed with HANDED_TIMEOUT / HANDED_FAILURE in its reason code is one, and the reason code wins over the Julius code', () => {
    for (const [cause, code] of [['HANDED_TIMEOUT_OUTCOME_UNKNOWN', 'TIMEOUT'], ['HANDED_FAILURE_OUTCOME_UNKNOWN', 'PROVIDER_UNAVAILABLE']] as const) {
      expect(outcomeUnknownFrom(failures([{ task_id: 'task:plan:1', role: 'PROMPT_ARCHITECT', event_type: 'julius.task.failed', julius_code: code, failure_class: 'PROVIDER_BOUNDARY', reason_code: cause }]), WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES))
        .toEqual({ cause, role: 'PROMPT_ARCHITECT', taskId: 'task:plan:1' });
    }
    // A retried timeout (no reason code) is not an unknown outcome.
    expect(outcomeUnknownFrom(failures([{ event_type: 'julius.task.failed', julius_code: 'TIMEOUT' }]), WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES)).toBeNull();
  });

  it('a task.failed carrying the cause is one too', () => {
    expect(outcomeUnknownFrom(failures([{ task_id: 'task:plan:1', role: 'PROMPT_ARCHITECT', event_type: 'julius.task.failed', failure_class: 'HANDED_OUTCOME_UNKNOWN' }]), WLJ, JULIUS_OUTCOME_UNKNOWN_CAUSES))
      .toEqual({ cause: 'HANDED_OUTCOME_UNKNOWN', role: 'PROMPT_ARCHITECT', taskId: 'task:plan:1' });
  });

  it('the reader binds it to the spend tag\'s FINISHED run of any conclusion, and names that run', async () => {
    const tag = tagMessage(WLJ);
    const reader = createJuliusMissionEvidenceReader(github(tag, failedRun(failures([HANDED]))));
    expect(await reader.readOutcomeUnknown?.(WLJ)).toEqual({ cause: 'HANDED_OUTCOME_UNKNOWN', role: 'CODING_AGENT', taskId: 'task:build:1', workflowRunId: RUN });
    // Still running, another head, another attempt: none read.
    for (const run of [
      failedRun(failures([HANDED]), { status: 'in_progress', conclusion: null }),
      failedRun(failures([HANDED]), { headSha: 'b'.repeat(40) }),
      failedRun(failures([HANDED]), { workflowRunAttempt: '2' }),
    ]) {
      expect(await createJuliusMissionEvidenceReader(github(tag, run)).readOutcomeUnknown?.(WLJ)).toBeNull();
    }
    expect(await createJuliusMissionEvidenceReader(github(null, failedRun(failures([HANDED])))).readOutcomeUnknown?.(WLJ)).toBeNull();
    expect(await createJuliusMissionEvidenceReader(github(tag, 'throw-run')).readOutcomeUnknown?.(WLJ)).toBeNull();
    expect(await createJuliusMissionEvidenceReader(github(tag, failedRun(failures([HANDED])))).readOutcomeUnknown?.(LEGACY)).toBeNull();
  });

  it('it is accepted only for the run the dispatch recorded, in its exact shape', () => {
    const value = { cause: 'HANDED_OUTCOME_UNKNOWN', role: 'CODING_AGENT', taskId: 'task:build:1', workflowRunId: RUN };
    expect(acceptJuliusOutcomeUnknown(value, RUN)).toEqual({ cause: 'HANDED_OUTCOME_UNKNOWN', role: 'CODING_AGENT', taskId: 'task:build:1' });
    expect(acceptJuliusOutcomeUnknown(value, '4243')).toBeNull();
    expect(acceptJuliusOutcomeUnknown(value, null)).toBeNull();
    expect(acceptJuliusOutcomeUnknown({ ...value, cause: 'TIMEOUT' }, RUN)).toBeNull();
    expect(acceptJuliusOutcomeUnknown({ ...value, role: 'SOMEONE' }, RUN)).toBeNull();
    expect(acceptJuliusOutcomeUnknown({ ...value, taskId: 'bad id with spaces' }, RUN)).toBeNull();
    expect(acceptJuliusOutcomeUnknown({ ...value, role: null, taskId: null }, RUN)).toEqual({ cause: 'HANDED_OUTCOME_UNKNOWN', role: null, taskId: null });
    expect(acceptJuliusOutcomeUnknown(null, RUN)).toBeNull();
  });

  it('the bridge\'s cached reader keeps the method, and keeps a found outcome', async () => {
    const source = github(tagMessage(WLJ), failedRun(failures([HANDED])));
    const cached = cachedEvidenceReader(createJuliusMissionEvidenceReader(source), () => 0);
    expect(await cached.readOutcomeUnknown?.(WLJ)).toMatchObject({ cause: 'HANDED_OUTCOME_UNKNOWN' });
    const calls = source.calls.length;
    expect(await cached.readOutcomeUnknown?.(WLJ)).toMatchObject({ cause: 'HANDED_OUTCOME_UNKNOWN' });
    expect(source.calls.length).toBe(calls);
  });
});

/* ------------------------------------------------------------------------------------------------
 * X′ §4: /result from the RESULT RECORD when the artifacts are absent, bound to the run the
 * protected spend tag names through that run's own jobs (the REVIEW run-binding amendment).
 * ---------------------------------------------------------------------------------------------- */
describe('X′ §4: the result record, bound to the spend record, the pinned checker, judged==published, the bot status AND the run', () => {
  const SUFFIX = '0123456789ab4cde8fab0123456789ab';
  const RESULT_REF = `refs/tags/julius-run-record-${SUFFIX}-result`;
  const JUDGED = 'b'.repeat(64);
  const LIVE_JOB = 'Preflight, then the live mission';
  const LIVE_STEP = 'LIVE: run the first real Julius mission';
  const GRADE_JOB = 'J1: grade the final message with the pinned hidden checker';
  const GRADE_STEP = 'J1: stage the pinned checker from git objects and grade';
  const PASS_STEP = "J1: the pinned checker's verdict is PASS";
  const FAIL_STEP = "J1: the pinned checker's verdict is FAIL";

  type Fields = Record<string, string>;
  const resultBody = (over: Fields = {}): string => {
    const fields: Fields = {
      run: WLJ, namespace: 'julius-first-live', workflow_run_id: RUN, workflow_run_attempt: ATTEMPT, head_sha: SHA,
      final_state: 'COMPLETED', completed_at: '2026-10-24T13:00:00Z', verdict: 'PASS',
      checker_sha256: J1_PINNED_CHECKER_FILE_SHA256, combined_pin_sha256: J1_GRADE_COMBINED_PIN_SHA256,
      judged_trimmed_sha256: JUDGED, published_trimmed_sha256: JUDGED, final_message_sha256: JUDGED,
      outcome_unknown: 'none', cost_basis: 'COMPLETE', usd_micros: '1234567',
      grader_sha256: 'e'.repeat(64), node_sha256: 'd'.repeat(64), node_version: 'v22.23.2',
      ...over,
    };
    return `${['julius-run-result.v1', ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)].join('\n')}\n`;
  };
  const digest = (body: string): string => createHash('sha256').update(body).digest('hex');

  interface World {
    spendTag?: string | null;
    result?: string | null;
    run?: Record<string, unknown> | null;
    jobs?: readonly Record<string, unknown>[] | null;
    statuses?: readonly Record<string, unknown>[] | null;
    artifacts?: JuliusMissionWorkflowRun['artifacts'];
    jobsByRun?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  }
  const step = (name: string, conclusion: string | null) => ({ name, status: conclusion === null ? 'in_progress' : 'completed', conclusion });
  const job = (name: string, conclusion: string | null, steps: readonly ReturnType<typeof step>[]) => ({ name, status: conclusion === null ? 'in_progress' : 'completed', conclusion, steps });
  const passingJobs = (over: { live?: string | null; liveStep?: string | null; grade?: string | null; gradeStep?: string | null; pass?: string | null; fail?: string | null } = {}) => [
    job('spend-tag', 'success', []),
    job(LIVE_JOB, over.live === undefined ? 'success' : over.live, [step(LIVE_STEP, over.liveStep === undefined ? 'success' : over.liveStep)]),
    job(GRADE_JOB, over.grade === undefined ? 'success' : over.grade, [
      step(GRADE_STEP, over.gradeStep === undefined ? 'success' : over.gradeStep),
      ...(over.pass === null ? [] : [step(PASS_STEP, over.pass === undefined ? 'success' : over.pass)]),
      ...(over.fail === null ? [] : [step(FAIL_STEP, over.fail === undefined ? 'skipped' : over.fail)]),
    ]),
  ];
  /** A run whose own checker said FAIL: the grade job and step succeed (a FAIL exits 0), FAIL ran, PASS skipped. */
  const failingJobs = () => passingJobs({ pass: 'skipped', fail: 'success' });
  const botStatus = (body: string, over: Record<string, unknown> = {}) => ({
    context: 'julius-run-result', state: 'success', description: `v1 sha256:${digest(body)}`, creator: 'github-actions[bot]',
    targetUrl: `https://github.com/ohdieyuh-glitch/sunday-relay/actions/runs/${RUN}`, ...over,
  });
  const theRun = (over: Record<string, unknown> = {}) => ({
    id: RUN, attempt: 1, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', headBranch: 'main', headSha: SHA,
    path: '.github/workflows/julius-first-live-mission.yml', ...over,
  });

  function world(input: World = {}) {
    const body = input.result === undefined ? resultBody() : input.result;
    const calls: string[] = [];
    const githubPort: JuliusMissionGitHub = {
      async readAnnotatedTagMessage(tagRef) {
        calls.push(`tag ${tagRef}`);
        if (tagRef === RESULT_REF) return body;
        return input.spendTag === undefined ? tagMessage(WLJ) : input.spendTag;
      },
      async readWorkflowRun() { return workflow({ artifacts: input.artifacts ?? [] }); },
    };
    const records = {
      async readRun(id: string) { calls.push(`run ${id}`); return input.run === undefined ? theRun({ id }) : input.run; },
      async readRunJobs(id: string, attempt: number) {
        calls.push(`jobs ${id} ${String(attempt)}`);
        if (input.jobsByRun?.[id] !== undefined) return input.jobsByRun[id];
        return input.jobs === undefined ? passingJobs() : input.jobs;
      },
      async readCommitStatuses(sha: string) {
        calls.push(`statuses ${sha}`);
        return input.statuses === undefined ? (body === null ? [] : [botStatus(body)]) : input.statuses;
      },
    };
    return { reader: createJuliusMissionEvidenceReader(githubPort, records as never), calls };
  }
  const verdictOf = async (input: World = {}): Promise<string | null> => {
    const reading = await world(input).reader.read(WLJ) as JuliusMissionCompletionEvidence | null;
    return reading === null ? null : reading.checkerVerdict;
  };

  it('PASS through the tag form with every binding correct, read at the SPEND tag\'s run id and attempt', async () => {
    const { reader, calls } = world();
    const reading = await reader.read(WLJ) as JuliusMissionCompletionEvidence;
    expect(reading.juliusFinalState).toBe('COMPLETED');
    expect(reading.checkerVerdict).toBe('PASS');
    expect(reading.checker).toEqual({ reason: null, taskId: null, judgedTrimmedSha256: JUDGED, gameDigest: JUDGED.slice(0, 12), checkerSha256: J1_PINNED_CHECKER_FILE_SHA256 });
    expect(reading.missionCost).toEqual({ knownUsdMicros: 1234567, unknownComponents: 0, complete: true });
    expect(reading.spendTag.workflowRunId).toBe(RUN);
    expect(reading.archive).toBeNull();
    expect(reading.phases).toBeNull();
    expect(calls).toContain(`run ${RUN}`);
    expect(calls).toContain(`jobs ${RUN} 1`);
    expect(calls).toContain(`statuses ${SHA}`);
    // And the route's own acceptance keeps it.
    expect(acceptJuliusMissionEvidence(WLJ, reading).completion?.checkerVerdict).toBe('PASS');
  });

  it('THE ARTIFACT PATH WINS WHEN PRESENT: a run with its evidence and verdict artifacts never reads the result record', async () => {
    const { reader, calls } = world({ artifacts: [
      { name: 'julius-live-evidence', files: [{ path: 'live-mission.evidence.txt', text: RESULT }] },
      { name: 'julius-first-live-completed', files: [{ path: 'marker.txt', text: MARKER }] },
      { name: 'julius-inworld-verdict', files: [{ path: 'checker-verdict.txt', text: 'schema=julius-inworld-verdict.v1\nverdict=NOT_RUN\n' }] },
    ] });
    const reading = await reader.read(WLJ) as JuliusMissionCompletionEvidence;
    expect(reading.checkerVerdict).toBe('NOT_RUN');
    expect(calls).not.toContain(`tag ${RESULT_REF}`);
    expect(calls.some((call) => call.startsWith('jobs '))).toBe(false);
  });

  it('MUTATION: a forged PASS tag plus a VALID bot status, with the grade step FAILED, is never PASS', async () => {
    expect(await verdictOf({ jobs: passingJobs({ gradeStep: 'failure', grade: 'failure', pass: 'skipped' }) })).not.toBe('PASS');
    // Even if the attacker's world kept the PASS step green: the grade step decides.
    expect(await verdictOf({ jobs: passingJobs({ gradeStep: 'failure' }) })).not.toBe('PASS');
  });

  it('MUTATION: the same with the grade JOB missing, or its PASS step skipped (a real FAIL also exits 0), is never PASS', async () => {
    expect(await verdictOf({ jobs: passingJobs().filter((entry) => entry.name !== GRADE_JOB) })).not.toBe('PASS');
    expect(await verdictOf({ jobs: passingJobs({ pass: 'skipped' }) })).not.toBe('PASS');
    expect(await verdictOf({ jobs: passingJobs({ pass: null }) })).not.toBe('PASS');
    expect(await verdictOf({ jobs: passingJobs({ grade: null, gradeStep: null }) })).not.toBe('PASS');
    expect(await verdictOf({ jobs: passingJobs({ grade: 'cancelled' }) })).not.toBe('PASS');
  });

  it('MUTATION: the same with LIVE failed is not even completion', async () => {
    expect(await verdictOf({ jobs: passingJobs({ live: 'failure' }) })).toBeNull();
    expect(await verdictOf({ jobs: passingJobs({ liveStep: 'failure' }) })).toBeNull();
    expect(await verdictOf({ jobs: passingJobs({ liveStep: 'skipped' }) })).toBeNull();
    expect(await verdictOf({ jobs: passingJobs().filter((entry) => entry.name !== LIVE_JOB) })).toBeNull();
  });

  it('MUTATION: the run id is the SPEND tag\'s, never the result tag\'s', async () => {
    // A forger points the result tag at its own green run 9999; the spend tag's run 4242 failed grading.
    const forged = resultBody({ workflow_run_id: '9999' });
    const { reader, calls } = world({
      result: forged,
      statuses: [botStatus(forged, { targetUrl: 'https://github.com/ohdieyuh-glitch/sunday-relay/actions/runs/9999' })],
      jobsByRun: { 9999: passingJobs(), [RUN]: passingJobs({ gradeStep: 'failure', grade: 'failure', pass: 'skipped' }) },
    });
    expect(await reader.read(WLJ)).toBeNull();
    expect(calls).not.toContain('run 9999');
    expect(calls).not.toContain('jobs 9999 1');
  });

  it('D-b SYMMETRIC: a real FAIL shows FAIL (the FAIL step ran, the PASS step was skipped); otherwise unverified', async () => {
    const fail = resultBody({ verdict: 'FAIL' });
    const failStatus = (body: string) => [botStatus(body, { state: 'failure' })];
    const reading = await world({ result: fail, statuses: failStatus(fail), jobs: failingJobs() }).reader.read(WLJ) as JuliusMissionCompletionEvidence;
    expect(reading.juliusFinalState).toBe('COMPLETED');
    expect(reading.checkerVerdict).toBe('FAIL');
    expect(acceptJuliusMissionEvidence(WLJ, reading).completion?.checkerVerdict).toBe('FAIL');
    // The FAIL step missing, skipped, or failed; the PASS step not skipped; the grade step failed: each unverified.
    for (const jobs of [
      passingJobs({ pass: 'skipped', fail: null }), passingJobs({ pass: 'skipped', fail: 'skipped' }), passingJobs({ pass: 'skipped', fail: 'failure' }),
      passingJobs({ pass: null, fail: 'success' }), passingJobs({ gradeStep: 'failure', grade: 'failure', pass: 'skipped', fail: 'skipped' }),
    ]) expect(await verdictOf({ result: fail, statuses: failStatus(fail), jobs }), JSON.stringify(jobs.at(-1))).toBe('NOT_RUN');
    const notRun = resultBody({ verdict: 'NOT_RUN' });
    expect(await verdictOf({ result: notRun, statuses: failStatus(notRun) })).toBe('NOT_RUN');
  });

  it('X-1: another run\'s julius-run-result at the same head does not break a genuine PASS', async () => {
    const body = resultBody();
    const otherBody = resultBody({ workflow_run_id: '9999' });
    const other = botStatus(otherBody, { targetUrl: 'https://github.com/ohdieyuh-glitch/sunday-relay/actions/runs/9999' });
    expect(await verdictOf({ statuses: [other, botStatus(body)] })).toBe('PASS');
    expect(await verdictOf({ statuses: [botStatus(body), other, botStatus(otherBody, { state: 'failure', targetUrl: 'https://github.com/ohdieyuh-glitch/sunday-relay/actions/runs/9998' })] })).toBe('PASS');
  });

  it('X-1: two statuses that both name this run and this digest are unverified', async () => {
    expect(await verdictOf({ statuses: [botStatus(resultBody()), botStatus(resultBody())] })).toBeNull();
  });

  it('X-1: a forged status with the right run id and the WRONG digest is not a candidate: alone it is unverified, beside the real one it is ignored', async () => {
    const forged = botStatus(resultBody(), { description: `v1 sha256:${'0'.repeat(64)}` });
    expect(await verdictOf({ statuses: [forged] })).toBeNull();
    expect(await verdictOf({ statuses: [forged, botStatus(resultBody())] })).toBe('PASS');
    // Nor is one from another creator, even with the right run and digest.
    expect(await verdictOf({ statuses: [botStatus(resultBody(), { creator: 'ohdieyuh-glitch' })] })).toBeNull();
  });

  it('X-3: the record is BYTE-EXACT: a CR, a missing final LF or a trailing blank line is not the record (no normalization)', () => {
    const body = resultBody();
    expect(parseJuliusRunResultRecord(body)).not.toBeNull();
    for (const bad of [body.replace(/\n/gu, '\r\n'), body.slice(0, -1), `${body}\n`, body.replace('\nrun=', '\r\nrun=')]) {
      expect(parseJuliusRunResultRecord(bad), JSON.stringify(bad.slice(-12))).toBeNull();
    }
  });

  it('X-3: the status digest is sha256 of the tag message bytes as read, not of any normalized form', async () => {
    const body = resultBody();
    expect(await verdictOf({ statuses: [botStatus(body, { description: `v1 sha256:${digest(`${body}\n`)}` })] })).toBeNull();
    expect(await verdictOf({ statuses: [botStatus(body, { description: `v1 sha256:${digest(body.slice(0, -1))}` })] })).toBeNull();
    expect(await verdictOf({})).toBe('PASS');
  });

  it('X-4: the combined pin of every staged grading input must be the pinned one; the grader and node fingerprints are recorded', async () => {
    expect(await verdictOf({ result: resultBody({ combined_pin_sha256: 'c'.repeat(64) }) })).toBe('NOT_RUN');
    expect(await verdictOf({ result: resultBody({ combined_pin_sha256: 'none' }) })).toBe('NOT_RUN');
    expect(parseJuliusRunResultRecord(resultBody())).toMatchObject({ graderSha256: 'e'.repeat(64), nodeSha256: 'd'.repeat(64), nodeVersion: 'v22.23.2' });
    expect(parseJuliusRunResultRecord(resultBody({ grader_sha256: 'none', node_sha256: 'none', node_version: 'none' }))).toMatchObject({ graderSha256: null, nodeSha256: null, nodeVersion: null });
    for (const over of [{ grader_sha256: 'x' }, { node_sha256: 'D'.repeat(64) }, { node_version: '22.1.0' }, { node_version: 'v22.1.0 extra' }] as readonly Record<string, string>[]) {
      expect(parseJuliusRunResultRecord(resultBody(over)), JSON.stringify(over)).toBeNull();
    }
  });

  it('MUTATION D-b: a forged PASS tag over a real FAIL is unverified', async () => {
    expect(await verdictOf({ jobs: failingJobs() })).toBe('NOT_RUN');
  });

  it('MUTATION D-b: a forged FAIL tag over a real PASS is unverified', async () => {
    const fail = resultBody({ verdict: 'FAIL' });
    expect(await verdictOf({ result: fail, statuses: [botStatus(fail, { state: 'failure' })], jobs: passingJobs() })).toBe('NOT_RUN');
  });

  it('MUTATION D-b: BOTH verdict steps succeeded is unverified, whichever the tag says', async () => {
    const both = passingJobs({ pass: 'success', fail: 'success' });
    expect(await verdictOf({ jobs: both })).toBe('NOT_RUN');
    const fail = resultBody({ verdict: 'FAIL' });
    expect(await verdictOf({ result: fail, statuses: [botStatus(fail, { state: 'failure' })], jobs: both })).toBe('NOT_RUN');
  });

  it('(i) the run itself: path, attempt 1, head, workflow_dispatch, main, completed; each violation is unverified', async () => {
    for (const over of [
      { path: '.github/workflows/relay-ci.yml' }, { attempt: 2 }, { headSha: 'f'.repeat(40) }, { event: 'push' },
      { headBranch: 'julius/forged' }, { status: 'in_progress' }, { id: '4243' },
    ]) expect(await verdictOf({ run: theRun(over) }), JSON.stringify(over)).toBeNull();
    expect(await verdictOf({ run: null })).toBeNull();
    expect(await verdictOf({ spendTag: tagMessage(WLJ).replace('workflow_run_attempt=1', 'workflow_run_attempt=2') })).toBeNull();
  });

  it('each single violation of the tag or the status falls back to unverified', async () => {
    const cases: readonly [string, World][] = [
      ['wrong run', { result: resultBody({ run: 'wlj_11111111-89ab-4cde-8fab-0123456789ab' }) }],
      ['wrong attempt', { result: resultBody({ workflow_run_attempt: '2' }) }],
      ['wrong sha', { result: resultBody({ head_sha: 'e'.repeat(40) }) }],
      ['wrong namespace', { result: resultBody({ namespace: 'julius-inworld-data-1' }) }],
      ['not v1', { result: resultBody().replace('julius-run-result.v1', 'julius-run-result.v0') }],
      ['a smuggled line', { result: `${resultBody()}extra=1\n` }],
      ['no tag', { result: null }],
      ['status not from the bot', { statuses: [botStatus(resultBody(), { creator: 'ohdieyuh-glitch' })] }],
      ['status hash mismatch', { statuses: [botStatus(resultBody(), { description: `v1 sha256:${'0'.repeat(64)}` })] }],
      ['status names another run', { statuses: [botStatus(resultBody(), { targetUrl: 'https://github.com/ohdieyuh-glitch/sunday-relay/actions/runs/9999' })] }],
      ['status without a target', { statuses: [botStatus(resultBody(), { targetUrl: null })] }],
      ['status state contradicts', { statuses: [botStatus(resultBody(), { state: 'failure' })] }],
      ['two statuses', { statuses: [botStatus(resultBody()), botStatus(resultBody())] }],
      ['missing status', { statuses: [] }],
      ['statuses unreadable', { statuses: null }],
      ['jobs unreadable', { jobs: null }],
    ];
    for (const [label, input] of cases) expect(await verdictOf(input), label).toBeNull();
  });

  it('the pinned checker and judged == published are required for a PASS', async () => {
    expect(await verdictOf({ result: resultBody({ checker_sha256: 'd'.repeat(64) }), statuses: undefined })).toBe('NOT_RUN');
    expect(await verdictOf({ result: resultBody({ published_trimmed_sha256: 'e'.repeat(64) }) })).toBe('NOT_RUN');
    expect(await verdictOf({ result: resultBody({ published_trimmed_sha256: 'none' }) })).toBe('NOT_RUN');
  });

  it('MUTATION GUARD: skip the status binding and a forged tag still must not PASS (the run binding alone holds it)', async () => {
    // No status at all: unverified. A forged PASS over a run whose PASS step never ran: not PASS.
    expect(await verdictOf({ statuses: [] })).toBeNull();
    expect(await verdictOf({ jobs: passingJobs({ pass: 'skipped' }) })).toBe('NOT_RUN');
  });

  it('FAIL CLOSED: any read that throws is unverified, and a reader with no run records reads artifacts only', async () => {
    const throwing = (which: 'readRun' | 'readRunJobs' | 'readCommitStatuses') => {
      const base = world();
      const githubPort: JuliusMissionGitHub = { async readAnnotatedTagMessage(ref) { return ref === RESULT_REF ? resultBody() : tagMessage(WLJ); }, async readWorkflowRun() { return workflow(); } };
      const records = {
        readRun: async () => theRun(), readRunJobs: async () => passingJobs(), readCommitStatuses: async () => [botStatus(resultBody())],
        [which]: async () => { throw new Error('unreadable'); },
      };
      void base;
      return createJuliusMissionEvidenceReader(githubPort, records as never);
    };
    for (const which of ['readRun', 'readRunJobs', 'readCommitStatuses'] as const) expect(await throwing(which).read(WLJ), which).toBeNull();
    const noRecords = createJuliusMissionEvidenceReader({ async readAnnotatedTagMessage() { return tagMessage(WLJ); }, async readWorkflowRun() { return workflow(); } });
    expect(await noRecords.read(WLJ)).toBeNull();
  });

  it('outcome-unknown from the record only when the run\'s own LIVE job and step FAILED', async () => {
    const body = resultBody({ final_state: 'FAILED', completed_at: 'none', verdict: 'NOT_RUN', outcome_unknown: 'HANDED_TIMEOUT_OUTCOME_UNKNOWN/CODING_AGENT/build:1', judged_trimmed_sha256: 'none', published_trimmed_sha256: 'none', final_message_sha256: 'none' });
    const statuses = [botStatus(body, { state: 'failure' })];
    const failed = world({ result: body, statuses, jobs: passingJobs({ live: 'failure', liveStep: 'failure', pass: 'skipped' }) });
    expect(await failed.reader.readOutcomeUnknown?.(WLJ)).toEqual({ cause: 'HANDED_TIMEOUT_OUTCOME_UNKNOWN', role: 'CODING_AGENT', taskId: 'build:1', workflowRunId: RUN });
    expect(acceptJuliusOutcomeUnknown(await failed.reader.readOutcomeUnknown?.(WLJ), RUN)).not.toBeNull();
    const green = world({ result: body, statuses });
    expect(await green.reader.readOutcomeUnknown?.(WLJ)).toBeNull();
    expect(await failed.reader.read(WLJ)).toBeNull();
  });
});

describe('X-4: the reader\'s inlined combined pin is the grader\'s', () => {
  it('J1_GRADE_COMBINED_PIN_SHA256 equals J1_GRADE_PINS.combinedSha256', async () => {
    const { J1_GRADE_PINS } = await import('../scripts/julius-inworld-grade.mjs');
    expect(J1_GRADE_COMBINED_PIN_SHA256).toBe(J1_GRADE_PINS.combinedSha256);
  });
});
