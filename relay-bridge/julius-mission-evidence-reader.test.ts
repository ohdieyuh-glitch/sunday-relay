import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — the archive script is exercised for its digest only.
import { bundleDigest } from '../scripts/julius-paid-run-archive.mjs';
import { deriveJuliusSpentTag } from '../scripts/julius-admission-run-id.mjs';
import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
import {
  createJuliusMissionEvidenceReader,
  type JuliusMissionGitHub,
  type JuliusMissionWorkflowRun,
} from './julius-mission-evidence-reader';

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

function workflow(overrides: Partial<JuliusMissionWorkflowRun> = {}): JuliusMissionWorkflowRun {
  return {
    workflowRunId: RUN,
    workflowRunAttempt: ATTEMPT,
    headSha: SHA,
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
});
