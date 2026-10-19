/**
 * QUALIFICATION ATTEMPT 4 (run 34774471909), REPLAYED WITH NO SPEND.
 *
 * The one page Julius served that run never reached the worker that asked for
 * it. The Prompt Architect's first plan dispatch read the psql reference page
 * (269,680 bytes of HTML). Its continuation's context grew by 685 characters,
 * and the continuation after a REFUSED read grew by 927: a refusal delivered
 * more text than the page did. Every later ask was refused by the byte ledger,
 * the coder never learned what psql writes for a SQL NULL, and the build kept
 * its sentinel throw until the tick ceiling stopped the run.
 *
 * The runtime under drive is `assembleLiveJuliusRuntime`, the one live
 * composition root, with the production worker registrations and the real
 * mediator, Live Reach service, pipeline and context compiler. The only fakes
 * are the provider adapters and `fetch`.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { redactText } from '../../src/relay/mcp/policy/mcp-sanitize';

import {
  createJuliusMemoryStore,
  scriptedAdapter,
  sealJuliusResearchPolicy,
  seedJuliusTaskContract,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
  type JuliusTimelineEntry,
  type ScriptedOutcome,
} from '../../src/relay/mission/julius';
import type { BackendProbe } from '../../src/relay/mission/live-reach';
import {
  architectWorker,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  liveContextCharacterBudget,
  reviewerWorker,
} from './live-composition';

const RUN = 'run-a4';
const PROJECT = 'prj-a4';
const MISSION = 'mission-a4';
const HOST = 'docs.qualification.test';
const REVIEWER_WORKER = reviewerWorker('hermes');

const OBSERVED_BACKENDS: readonly BackendProbe[] = Object.freeze([
  { backendId: 'relay_http_fetch', capability: 'read_item', result: 'observed', probedAt: '2026-09-13T18:00:00.000Z' },
]);

/** Attempt 4's grant, as `julius-continuous-1` sealed it: 3 reads / 300 KB a slot, 9 / 900 KB a mission. */
const attemptFourGrant = (missionId: string) => sealJuliusResearchPolicy({
  missionId,
  allowances: [{ source: 'web', capabilities: ['read_item'], hosts: [HOST] }],
  roles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
  missionBudget: { maxRetrievals: 9, maxBytes: 900_000 },
  roleBudget: { maxRetrievals: 3, maxBytes: 300_000 },
});

/** The documented fact the mission needed, verbatim from the psql reference. */
const FACT = 'Sets the string to be printed in place of a null value. The default is to print nothing, which can easily be mistaken for an empty string.';

/**
 * A PAGE SHAPED LIKE app-psql.html: 269,548 characters of HTML with the fact at
 * byte 163,593, surrounded by navigation, option reference prose and the
 * decoys the real page carries (NOT NULL, NULL fields, a column that is NULL).
 */
function psqlShapedPage(): string {
  const head = `<!doctype html><html lang="en"><head><title>PostgreSQL: Documentation: psql</title>`
    + `<script>window.dataLayer=[];</script></head><body><nav>${'<a href="/docs/">Documentation</a> '.repeat(120)}</nav>`;
  // Markup weighs as much as prose here, as it does on the real page (269,548
  // characters of HTML, 126,212 readable): classes, links and a comment per entry.
  const option = (index: number) => `<!-- ${'generated option index entry '.repeat(6)}-->`
    + `<dt class="varlistentry"><span class="term"><a class="link" href="#option-${String(index)}"><code class="literal">option${String(index)}</code></a></span></dt><dd><p>`
    + `Controls how psql formats output in aligned, wrapped and unaligned modes. The value is read when the next `
    + `query result is printed, and the default applies until it is changed with \\pset. </p></dd>\n`;
  const decoys = '<p>Describes the table, including column types, the tablespace and attributes such as NOT NULL or defaults.</p>'
    + '<p>NULL fields are ignored. The generated queries are sent literally.</p>'
    + '<p>If a column result is NULL, the corresponding variable is unset rather than being set.</p>';
  const target = `<dt id="APP-PSQL-META-COMMAND-PSET-NULL"><code class="literal">null</code></dt><dd><p>${FACT} `
    + `For example, one might prefer <code class="literal">\\pset null '(null)'</code>.</p></dd>\n`;

  let before = head + decoys;
  for (let index = 0; before.length < 163_593 - 120; index += 1) before += option(index);
  before = before.slice(0, 163_593 - 118);
  const page = `${before}${target}`;
  let after = '';
  for (let index = 1000; page.length + after.length < 269_548; index += 1) after += option(index);
  const full = `${page}${after}`.slice(0, 269_548 - 14) + '</body></html>';
  return full;
}

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const REVIEW_PASS = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PLAN_OK: ScriptedOutcome = { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null };
const REVIEW_OK: ScriptedOutcome = { kind: 'succeed', evidence: REVIEW_PASS, usdMicros: null };
const BUILD_OK: ScriptedOutcome = { kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 5_177_120 };

const RESUME = Object.freeze({ completedSoFar: ['drafted the numeric readers'], nextIntent: 'settle the blank text cell' });
const askPage = (path: string, purpose: string): ScriptedOutcome => ({
  kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null,
  researchAsks: [{ source: 'web', capability: 'read_item', reference: `https://${HOST}/${path}`, purpose }],
  segmentResume: RESUME,
});

function localSources(pages: Readonly<Record<string, string>>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = pages[new URL(url).pathname.replace(/^\//u, '')];
    if (body === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
}

function seed(store: ReturnType<typeof createJuliusMemoryStore>): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: 'card-a4', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask(RUN, {
    taskId: 'plan-1', missionId: MISSION, parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask(RUN, {
    taskId: 'build-1', missionId: MISSION, parentTaskId: null, dependencyIds: ['plan-1'],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: 'build-1', missionContractRevision: 1,
    objective: 'Establish what the exporter writes for a SQL NULL and implement readTextCell.',
    requirements: ['Establish the NULL rendering from the psql reference.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The fixture test passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 30, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-09-13T18:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The fixture test passes.', requiredEvidenceTypes: [] }]);
  // A base context the size attempt 4 compiled for every dispatch (6,829 characters).
  store.seedBrain(RUN, [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: `OBJECTIVE: ${'Read every bundle cell honestly. '.repeat(212)}`,
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

async function drive(input: {
  readonly architect: readonly ScriptedOutcome[];
  readonly coder?: readonly ScriptedOutcome[];
  readonly pages: Readonly<Record<string, string>>;
  /** Extra run-wide Project Brain text every slot's packet is owed, in characters. */
  readonly extraBrainChars?: number;
}) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);
  if (input.extraBrainChars !== undefined) {
    const entries = Math.ceil(input.extraBrainChars / 2_000);
    memory.seedBrain(RUN, Array.from({ length: entries }, (_, index) => ({
      entryId: `brain-extra-${String(index)}`, kind: 'CONSTRAINT' as const, text: `CONSTRAINT ${String(index)}: ${'x'.repeat(1_985)}`,
      taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const, sensitivity: 'INTERNAL' as const,
    })));
  }
  const architect = scriptedAdapter(architectWorker({}), input.architect);
  const coder = scriptedAdapter(CODER_WORKER, input.coder ?? [BUILD_OK]);
  const reviewer = scriptedAdapter(REVIEWER_WORKER, [REVIEW_OK]);
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store,
    entries: [
      { worker: architectWorker({}), adapter: architect },
      { worker: CODER_WORKER, adapter: coder },
      { worker: REVIEWER_WORKER, adapter: reviewer },
    ],
    cardRevision: 'card-a4', spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3,
    researchPolicyFor: attemptFourGrant, researchProbes: OBSERVED_BACKENDS,
    researchFetch: localSources(input.pages),
  });
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT, maxTicks: 40,
  });
  const timeline: JuliusTimelineEntry[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await memory.timeline({ runId: RUN, projectId: PROJECT, sinceSequence, limit: 500 });
    timeline.push(...page.entries);
    if (page.entries.length === 0 || !page.hasMore) break;
    sinceSequence = Math.max(...page.entries.map((entry) => entry.sequence));
  }
  /** The packet a dispatch really compiled, by task id. */
  const packetOf = (taskId: string): { text: string; characterCount: number; truncated: boolean } | null => {
    const dispatch = [...architect.dispatches, ...coder.dispatches, ...reviewer.dispatches].find((row) => row.taskId === taskId);
    const snapshot = dispatch === undefined ? null : handoffs.contexts.snapshotFor(dispatch.contextId);
    if (snapshot === null || snapshot === undefined) return null;
    return {
      text: snapshot.packet.blocks.map((block) => block.text).join('\n'),
      characterCount: snapshot.characterCount,
      truncated: snapshot.truncated,
    };
  };
  return { outcome, timeline, packetOf, architect, coder, reviewer };
}

const retrieved = (timeline: readonly JuliusTimelineEntry[]) =>
  timeline.filter((entry) => entry.type === 'research.retrieved').map((entry) => entry.facts);

describe('A4-1 — a served page reaches the worker that asked for it', () => {
  it('CONTROL: a short page carrying the fact is delivered into the continuation packet', async () => {
    const { timeline, packetOf } = await drive({
      pages: { 'docs/app-psql.html': `<html><body><dl>${FACT}</dl></body></html>` },
      architect: [askPage('docs/app-psql.html', 'How psql renders a SQL NULL in unaligned output.'), PLAN_OK, PLAN_OK],
    });
    expect(retrieved(timeline).map((facts) => facts.outcome)).toEqual(['observed']);
    const packet = packetOf('segment:plan-1:2:task');
    expect(packet, 'the continuation was dispatched').not.toBeNull();
    expect(packet!.text).toContain(FACT);
  });

  it('the psql-sized page is served, and its fact reaches the continuation packet', async () => {
    const page = psqlShapedPage();
    expect(page.length).toBe(269_548);
    expect(page.indexOf(FACT)).toBeGreaterThan(163_000);
    const { timeline, packetOf } = await drive({
      pages: { 'docs/app-psql.html': page },
      architect: [askPage('docs/app-psql.html', 'How psql renders a SQL NULL in unaligned output.'), PLAN_OK, PLAN_OK],
    });
    expect(retrieved(timeline).map((facts) => facts.outcome), 'Julius served the read').toEqual(['observed']);
    const packet = packetOf('segment:plan-1:2:task');
    expect(packet, 'the continuation was dispatched').not.toBeNull();
    expect(packet!.text, 'what the worker was told instead').not.toContain('did not fit this packet');
    expect(packet!.text, 'the documented fact the worker asked for').toContain(FACT);
  });
});

describe('A4-2 — one observed read does not spend a 300 KB allowance', () => {
  it('a second read of a 2 KB page is served, not refused as unenforceable', async () => {
    const small = `<html><body>${'<p>reference</p>'.repeat(120)}</body></html>`;
    const { timeline } = await drive({
      pages: { a: small, b: small },
      architect: [askPage('a', 'Read a.'), askPage('b', 'Read b.'), PLAN_OK, PLAN_OK],
    });
    const rows = retrieved(timeline);
    expect(rows.map((facts) => `${String(facts.outcome)}/${String(facts.reasonCode)}`)).toEqual(['observed/null', 'observed/null']);
  });
});

const factsOfType = (timeline: readonly JuliusTimelineEntry[], type: string) =>
  timeline.filter((entry) => entry.type === type);

describe('A4-3 — the chain for a served page: ask → exact resource → bytes and digest → handoff → packet → reviewer trail', () => {
  it('every link is on the durable record, and the reviewer can check a citation without receiving the page', async () => {
    const page = psqlShapedPage();
    const { timeline, packetOf, reviewer, coder } = await drive({
      pages: { 'docs/app-psql.html': page },
      architect: [askPage('docs/app-psql.html', 'How psql renders a SQL NULL in unaligned output.'), PLAN_OK, PLAN_OK],
    });

    // 1. THE EXACT RESOURCE, THE BYTES AND THE DIGEST.
    const rows = retrieved(timeline);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const digest = `sha256:${createHash('sha256').update(redactText(page).text, 'utf8').digest('hex')}`;
    expect(row).toMatchObject({
      role: 'PROMPT_ARCHITECT', outcome: 'observed', askOrdinal: 0,
      requestedHost: HOST, resourcePath: '/docs/app-psql.html', mechanism: 'relay_http_fetch',
      bytes: 269_548, bytesRecorded: true, contentDigest: digest,
      deliveredFrom: 0, deliveryCut: false, deliveryAnchor: null,
      handoffTaskId: 'segment:plan-1:2:task', handoffEntryId: 'brain:research-answer:segment:plan-1:2:task',
    });
    expect(row.deliveredChars).toBe(row.readableChars);
    expect(Number(row.readableChars)).toBeGreaterThan(100_000);
    expect(JSON.stringify(row), 'no page text on the row').not.toContain('null value');

    // 2. THE HANDOFF WAS WRITTEN, and names what it carried.
    const verdict = factsOfType(timeline, 'checkpoint.verdict').find((entry) => entry.facts.route === 'SERVE_RESEARCH')!;
    expect(verdict.facts).toMatchObject({
      continuationTaskId: 'segment:plan-1:2:task',
      handoffEntryId: 'brain:research-answer:segment:plan-1:2:task',
      provenanceEntryId: 'brain:research-served:segment:plan-1:2:task',
      deliveredChars: row.deliveredChars,
    });

    // 3. THE CONTINUATION'S PACKET HOLDS IT, and the record says so.
    const compiled = factsOfType(timeline, 'context.compiled');
    expect(compiled.find((entry) => entry.taskId === 'segment:plan-1:2:task')?.facts.researchAnswerIncluded).toBe(true);
    expect(compiled.find((entry) => entry.taskId === 'plan-1')?.facts.researchAnswerIncluded, 'not a continuation: unknown, not false').toBeNull();
    const continuation = packetOf('segment:plan-1:2:task')!;
    expect(continuation.text).toContain(FACT);
    expect(continuation.text).toContain(`DELIVERED WHOLE: all ${String(row.readableChars)} readable characters`);
    expect(continuation.truncated).toBe(false);

    // 4. THE TRAIL. The reviewer of that plan, and the coder after it, carry
    //    Julius's record of the read — host, path, bytes, digest, destination —
    //    and not one character of the page.
    const review = reviewer.dispatches.find((dispatch) => dispatch.taskId === 'segment:plan-1:2:task:review');
    expect(review, 'the finished plan segment was reviewed').toBeDefined();
    for (const [label, text] of [['reviewer', packetOf(review!.taskId)!.text], ['coder', packetOf(coder.dispatches[0]!.taskId)!.text]] as const) {
      expect(text, `${label} carries the record`).toContain(`RESEARCH SERVED (Julius's record, no page text): the PROMPT_ARCHITECT`);
      expect(text, label).toContain(`https://${HOST}/docs/app-psql.html`);
      expect(text, label).toContain(digest);
      expect(text, label).toContain('269548 bytes fetched by relay_http_fetch');
      expect(text, label).toContain('handed to segment:plan-1:2:task');
      expect(text, `${label} is not handed the page`).not.toContain(FACT);
    }
  });
});

describe('A4-4 — a page larger than its share is cut truthfully, and a named section reaches the rest', () => {
  /** 200,000+ readable characters in about 215 KB, the fact past the first 149,000. */
  function denseReferencePage(): string {
    const paragraph = (index: number) => `<p>Paragraph ${String(index)} of the option reference describes aligned, wrapped and unaligned output in detail for operators.</p>\n`;
    let body = '';
    let index = 0;
    while (body.length < 190_000) body += paragraph(index++);
    body += `<dt id="APP-PSQL-META-COMMAND-PSET-NULL">null</dt><dd><p>${FACT}</p></dd>\n`;
    while (body.length < 212_000) body += paragraph(index++);
    return `<!doctype html><html><head><title>psql</title></head><body><h1 id="APP-PSQL">psql</h1>\n${body}</body></html>`;
  }

  it('the first read is an excerpt that says so and offers the section; asking for the section delivers the fact', async () => {
    const page = denseReferencePage();
    expect(page.length).toBeLessThan(300_000);
    const { timeline, packetOf } = await drive({
      pages: { 'docs/app-psql.html': page },
      architect: [
        askPage('docs/app-psql.html', 'How psql renders a SQL NULL in unaligned output.'),
        askPage('docs/app-psql.html#APP-PSQL-META-COMMAND-PSET-NULL', 'The null display setting.'),
        PLAN_OK, PLAN_OK,
      ],
    });
    const rows = retrieved(timeline);
    expect(rows.map((row) => `${String(row.outcome)}/${String(row.reasonCode)}`), 'the second read fits the 300 KB slot').toEqual(['observed/null', 'observed/null']);
    expect(rows[0]).toMatchObject({ deliveryCut: true, deliveredFrom: 0, deliveredChars: 149_000, deliveryAnchor: null, resourcePath: '/docs/app-psql.html' });
    expect(rows[1]).toMatchObject({ deliveryCut: true, deliveryAnchor: 'APP-PSQL-META-COMMAND-PSET-NULL', resourcePath: '/docs/app-psql.html' });
    expect(Number(rows[1]!.deliveredFrom)).toBeGreaterThan(149_000);

    const first = packetOf('segment:plan-1:2:task')!.text;
    expect(first).not.toContain(FACT);
    expect(first).toContain('EXCERPT: characters 1–149000 of');
    expect(first).toContain('Everything outside that range was NOT shown to you.');
    expect(first).toContain('#APP-PSQL-META-COMMAND-PSET-NULL');

    const second = packetOf('segment:plan-1:3:task')!.text;
    expect(second).toContain(FACT);
    expect(second).toContain('starting at section #APP-PSQL-META-COMMAND-PSET-NULL');
  });
});

describe('A4-5 — a replayed drive adds no second read, no second handoff and no second trail entry', () => {
  it('drives the same durable store twice and finds one of each', async () => {
    const memory = createJuliusMemoryStore();
    const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
    seed(memory);
    let fetches = 0;
    const pages = { 'docs/app-psql.html': psqlShapedPage() };
    const assemble = () => assembleLiveJuliusRuntime({
      store: handoffs.store,
      entries: [
        { worker: architectWorker({}), adapter: scriptedAdapter(architectWorker({}), [askPage('docs/app-psql.html', 'NULL rendering.'), PLAN_OK, PLAN_OK]) },
        { worker: CODER_WORKER, adapter: scriptedAdapter(CODER_WORKER, [BUILD_OK]) },
        { worker: REVIEWER_WORKER, adapter: scriptedAdapter(REVIEWER_WORKER, [REVIEW_OK]) },
      ],
      cardRevision: 'card-a4', spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3,
      researchPolicyFor: attemptFourGrant, researchProbes: OBSERVED_BACKENDS,
      researchFetch: (async (input: RequestInfo | URL) => { fetches += 1; return localSources(pages)(input); }) as typeof fetch,
    });
    const first = assemble();
    await driveJuliusRunToTerminal({ loop: first.loop, store: handoffs.store, runId: RUN, projectId: PROJECT, maxTicks: 40 });
    // A FRESH PROCESS over the same rows.
    const second = assemble();
    await driveJuliusRunToTerminal({ loop: second.loop, store: handoffs.store, runId: RUN, projectId: PROJECT, maxTicks: 40 });

    expect(fetches, 'the page was fetched once').toBe(1);
    const brain = await memory.brainEntriesForRun(RUN, PROJECT);
    expect(brain.filter((entry) => entry.entryId.startsWith('brain:research-answer:'))).toHaveLength(1);
    expect(brain.filter((entry) => entry.entryId.startsWith('brain:research-served:'))).toHaveLength(1);
    const timeline: JuliusTimelineEntry[] = [];
    let sinceSequence = 0;
    for (;;) {
      const page = await memory.timeline({ runId: RUN, projectId: PROJECT, sinceSequence, limit: 500 });
      timeline.push(...page.entries);
      if (page.entries.length === 0 || !page.hasMore) break;
      sinceSequence = Math.max(...page.entries.map((entry) => entry.sequence));
    }
    expect(retrieved(timeline)).toHaveLength(1);
  });
});

/**
 * THE REVIEWER'S PACKET STAYS THE SIZE IT WAS. Its prompt reaches Hermes as one
 * argv string, which Linux refuses past 131,072 bytes before any provider is
 * asked. Raising the architect's and coder's ceiling to carry a served page must
 * not raise the reviewer's.
 */
describe('A4-6 — the room made for a served page is the architect\'s and the coder\'s, never the reviewer\'s', () => {
  it('with 60,000 characters of run-wide context, the architect compiles all of it and the reviewer stops at 24,000', async () => {
    expect([liveContextCharacterBudget('PROMPT_ARCHITECT'), liveContextCharacterBudget('CODING_AGENT'), liveContextCharacterBudget('INDEPENDENT_REVIEWER')])
      .toEqual([200_000, 200_000, 24_000]);
    const { packetOf, reviewer, architect } = await drive({
      pages: {}, extraBrainChars: 60_000,
      architect: [PLAN_OK, PLAN_OK],
    });
    const plan = packetOf(architect.dispatches[0]!.taskId)!;
    expect(plan.characterCount, 'far past the reviewer ceiling').toBeGreaterThan(50_000);
    expect(plan.truncated).toBe(false);
    expect(reviewer.dispatches.length, 'the reviewer was dispatched').toBeGreaterThan(0);
    for (const dispatch of reviewer.dispatches) {
      const packet = packetOf(dispatch.taskId)!;
      expect(packet.characterCount, dispatch.taskId).toBeLessThanOrEqual(24_000);
      expect(packet.truncated, dispatch.taskId).toBe(true);
    }
  });
});
