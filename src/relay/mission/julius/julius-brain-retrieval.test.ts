import { describe, expect, it } from 'vitest';

import { juliusPrincipal, type JuliusBrainBody, type JuliusBrainRecordKind } from './julius-brain-contracts';
import { compileJuliusBrainContext } from './julius-brain-query';
import {
  createJuliusBrainBm25Retriever,
  createJuliusBrainHybridRetriever,
  createJuliusBrainKeywordRetriever,
  createJuliusBrainTrigramRetriever,
  decideJuliusBrainRetriever,
  evaluateJuliusBrainRetrievers,
  juliusBrainRetrievalEvalBody,
  juliusBrainSemanticCandidates,
  stemJuliusToken,
  type JuliusBrainRetrievalQuery,
} from './julius-brain-retrieval';
import { createJuliusProjectBrainService, defaultJuliusBrainReadGrant } from './julius-brain-service';
import { createJuliusBrainMemoryStore, readAllJuliusBrainEntities } from './julius-brain-store';

const PROJECT = 'prj-retrieval';
const BRAIN = 'brain:retrieval';
const MISSION = 'mission:retrieval';
const JULIUS = juliusPrincipal('JULIUS', 'julius');

const decision = (statement: string, rationale: string): JuliusBrainBody => ({ decisionClass: 'MISSION', statement, rationale, alternatives: [], status: 'ACTIVE' });
const research = (question: string, finding: string): JuliusBrainBody => ({ question, findings: [{ statement: finding, confidence: null }], sources: [], contradictions: [], unresolved: [], status: 'CONCLUDED' });
const finding = (statement: string): JuliusBrainBody => ({ findingClass: 'DEFECT', severity: 'MEDIUM', statement, blocking: false, status: 'OPEN', juliusFindingId: null });
const evidence = (claim: string, summary: string): JuliusBrainBody => ({ evidenceClass: 'OBSERVATION', claim, summary, status: 'PASSED', verification: 'UNVERIFIED', data: null, juliusEvidenceId: null });

/** A realistic Brain: the relevant entities, and distractors from unrelated work. */
const CORPUS: readonly [string, JuliusBrainRecordKind, JuliusBrainBody][] = [
  ['d-locks', 'DECISION', decision('Use PostgreSQL row locks under READ COMMITTED for Brain commits', 'Serializable isolation caused retry storms under contention')],
  ['d-cas', 'DECISION', decision('Store artifacts content-addressed by sha256', 'A reference must never silently point at different bytes')],
  ['d-network', 'DECISION', decision('Deny network access to Python analyses by default', 'An analysis with network access can exfiltrate mission data')],
  ['r-isolation', 'RESEARCH', research('Which isolation level prevents lost updates between concurrent writers?', 'A row lock taken by every writer serialises commits without retries')],
  ['r-latency', 'RESEARCH', research('How should latency regressions be detected?', 'A windowed p95 exposes tail regressions that a whole-period mean hides')],
  ['f-mean', 'FINDING', finding('The mean latency masks the regression in recent traffic')],
  ['f-redaction', 'FINDING', finding('Export bundles did not count the redactions they applied')],
  ['f-windows', 'FINDING', finding('Backslash paths on Windows broke the boundary scanner exclusion')],
  ['e-regressed', 'EVIDENCE', evidence('p95 latency regressed after sample 100', 'windowed p95 rose from 4ms to 7ms')],
  ['e-contention', 'EVIDENCE', evidence('eight concurrent revisions produced exactly one winner', 'seven version conflicts, no lost update')],
  ['req-latency', 'REQUIREMENT', { requirementClass: 'NON_FUNCTIONAL', statement: 'p95 latency stays within the 6 ms budget', priority: 'MUST', status: 'ACTIVE' }],
  ['req-redact', 'REQUIREMENT', { requirementClass: 'FUNCTIONAL', statement: 'Exports redact credentials before anything is written', priority: 'MUST', status: 'ACTIVE' }],
  ['c-providers', 'CONSTRAINT', { statement: 'No provider calls are made during tests', status: 'ACTIVE' }],
  ['q-working', 'OPEN_QUESTION', { question: 'Should working memory expire when the mission completes?', blocking: false, status: 'OPEN', answer: null }],
  ['h-retry', 'HANDOFF', { handoffClass: 'OTHER', fromRole: 'JULIUS', toRole: 'CODING_AGENT', summary: 'Implement retries for transient reviewer failures with a bounded backoff', openQuestions: [] }],
  ['comp-cas', 'ARCHITECTURE_COMPONENT', { name: 'Content store', responsibility: 'Holds artifact bytes addressed by their sha256 digest', interfaces: [], dependsOn: [], constraints: [] }],
  ['m-suite', 'MEMORY_FACT', { statement: 'The full test suite takes about fourteen minutes to run', trust: 'UNVERIFIED', expiresAt: null }],
  ['m-port', 'MEMORY_FACT', { statement: 'Docker cannot bind port 55432 because Windows reserves that range', trust: 'UNVERIFIED', expiresAt: null }],
  // Distractors.
  ['x-colours', 'DECISION', decision('Use the warm palette for onboarding screens', 'User research preferred warmer colours')],
  ['x-billing', 'DECISION', decision('Bill seats monthly with proration', 'Finance asked for predictable invoices')],
  ['x-copy', 'FINDING', finding('The onboarding copy mentions a feature that shipped late')],
  ['x-unreal', 'RESEARCH', research('How should the level stream its districts?', 'World partition cells of 256 metres keep hitches under a frame')],
  ['x-avatar', 'EVIDENCE', evidence('avatar materials compile on the L4 box', 'shader compile finished in 11 minutes')],
  ['x-email', 'REQUIREMENT', { requirementClass: 'FUNCTIONAL', statement: 'Weekly digest emails can be unsubscribed in one click', priority: 'SHOULD', status: 'ACTIVE' }],
  ['x-fonts', 'CONSTRAINT', { statement: 'Only self-hosted fonts are loaded by the website', status: 'ACTIVE' }],
  ['x-support', 'HANDOFF', { handoffClass: 'OTHER', fromRole: 'JULIUS', toRole: 'PROMPT_ARCHITECT', summary: 'Draft the support macro for refund requests', openQuestions: [] }],
  ['x-lighting', 'DECISION', decision('Bake lighting for the castle interior', 'Dynamic lighting cost too much on mobile')],
  ['x-latency-ui', 'FINDING', finding('The dashboard spinner flickers while charts load')],
  ['x-mean-ui', 'EVIDENCE', evidence('users mean to click the secondary button', 'heatmap shows misclicks on the primary call to action')],
  ['x-locks-ui', 'FINDING', finding('The lock icon in settings is hard to see in dark mode')],
  ['x-retry-billing', 'DECISION', decision('Retry failed card payments three times over a week', 'Most card failures are transient')],
  ['x-export-csv', 'REQUIREMENT', { requirementClass: 'FUNCTIONAL', statement: 'Admins can export the member list as CSV', priority: 'COULD', status: 'ACTIVE' }],
  ['x-memory-game', 'MEMORY_FACT', { statement: 'The memory card mini game needs a pause menu', trust: 'UNVERIFIED', expiresAt: null }],
  ['x-network-page', 'ARCHITECTURE_COMPONENT', { name: 'Network status page', responsibility: 'Shows public uptime for customers', interfaces: [], dependsOn: [], constraints: [] }],
];

const QUERIES: readonly JuliusBrainRetrievalQuery[] = [
  { queryId: 'q1', query: 'what did we decide about isolation for concurrent writers', relevant: ['d-locks', 'r-isolation'] },
  { queryId: 'q2', query: 'preventing lost updates', relevant: ['r-isolation', 'e-contention'] },
  { queryId: 'q3', query: 'is latency regressing', relevant: ['e-regressed', 'f-mean', 'r-latency'] },
  { queryId: 'q4', query: 'detecting tail regressions', relevant: ['r-latency'] },
  { queryId: 'q5', query: 'network access for python', relevant: ['d-network'] },
  { queryId: 'q6', query: 'sha256 addressed artifacts', relevant: ['d-cas', 'comp-cas'] },
  { queryId: 'q7', query: 'redaction in exports', relevant: ['f-redaction', 'req-redact'] },
  { queryId: 'q8', query: 'are credentials redacted', relevant: ['req-redact'] },
  { queryId: 'q9', query: 'windows path problems', relevant: ['f-windows'] },
  { queryId: 'q10', query: 'how long does the test suite take', relevant: ['m-suite'] },
  { queryId: 'q11', query: 'reserved docker port', relevant: ['m-port'] },
  { queryId: 'q12', query: 'retrying transient reviewer failure', relevant: ['h-retry'] },
  { queryId: 'q13', query: 'latency budget requirement', relevant: ['req-latency'] },
  { queryId: 'q14', query: 'provider calls in tests', relevant: ['c-providers'] },
  { queryId: 'q15', query: 'working memory expiry', relevant: ['q-working'] },
  { queryId: 'q16', query: 'mean hides recent traffic problems', relevant: ['f-mean', 'r-latency'] },
];

async function corpus() {
  const store = createJuliusBrainMemoryStore();
  const service = createJuliusProjectBrainService({ store, clock: { now: () => '2026-09-13T10:00:00.000Z' } });
  await service.initialize({ brainId: BRAIN, projectId: PROJECT, title: 'retrieval', principal: JULIUS });
  const handle = (await service.open({ brainId: BRAIN, projectId: PROJECT, principal: JULIUS }))!;
  const result = await handle.commit(CORPUS.map(([id, kind, body]) => handle.draft(kind, body, { key: id, entityId: id, scope: { missionId: MISSION } })));
  if (result.outcome !== 'COMMITTED') throw new Error(`${result.reasonCode}: ${result.detail}`);
  return { store, handle, entities: await readAllJuliusBrainEntities(store, BRAIN, PROJECT) };
}

describe('semantic retrieval earns its place — or does not', () => {
  it('stems only what it should', () => {
    expect(stemJuliusToken('regressions')).toBe(stemJuliusToken('regression'));
    expect(stemJuliusToken('redacted')).toBe('redact');
    expect(stemJuliusToken('bus')).toBe('bus');
  });

  it('measures baseline and candidates on labelled queries, deterministically, and adopts only measured value', async () => {
    const { entities, handle } = await corpus();
    const run = () => evaluateJuliusBrainRetrievers({
      corpus: entities, queries: QUERIES, k: 5, baseline: createJuliusBrainKeywordRetriever(),
      candidates: [createJuliusBrainBm25Retriever(), createJuliusBrainTrigramRetriever(), createJuliusBrainHybridRetriever()],
    });
    const result = run();
    expect(run()).toEqual(result);
    for (const row of [result.baseline, ...result.candidates]) {
      for (const value of [row.recallAtK, row.mrr, row.ndcgAtK]) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
      expect(row.perQuery).toHaveLength(QUERIES.length);
    }
    for (const candidate of result.candidates) {
      expect(candidate.marginal.mrr).toBeCloseTo(candidate.mrr - result.baseline.mrr, 3);
      expect(candidate.marginal.recallAtK).toBeCloseTo(candidate.recallAtK - result.baseline.recallAtK, 3);
    }
    const decision = decideJuliusBrainRetriever(result);
    if (process.env.JULIUS_BRAIN_RETRIEVAL_REPORT === '1') {
      process.stdout.write(`${JSON.stringify({ decision, rows: [result.baseline, ...result.candidates].map(({ retrieverId, recallAtK, mrr, ndcgAtK }) => ({ retrieverId, recallAtK, mrr, ndcgAtK })) })}\n`);
    }
    const best = [...result.candidates].sort((a, b) => b.mrr - a.mrr || b.recallAtK - a.recallAtK)[0]!;
    const shouldAdopt = best.marginal.mrr >= 0.05 && best.marginal.recallAtK >= 0;
    expect(decision.adopted).toBe(shouldAdopt ? best.retrieverId : result.baseline.retrieverId);
    // A bar no candidate can clear keeps the baseline, whatever the numbers.
    expect(decideJuliusBrainRetriever(result, 2).adopted).toBe('keyword-overlap');

    // The decision is itself evidence: recorded in the Brain as an EVAL.
    const recorded = await handle.create('EVAL', juliusBrainRetrievalEvalBody(result, decision, 'julius'), { key: 'retrieval-eval', scope: { missionId: MISSION } });
    expect(recorded.outcome).toBe('COMMITTED');
  });

  it('the fuzzy tier respects grants and lifecycles, and enters context last', async () => {
    const { entities, handle } = await corpus();
    const restricted = await handle.create('MEMORY_FACT', { statement: 'Isolation incident details are restricted', trust: 'UNVERIFIED', expiresAt: null }, { key: 'restricted', entityId: 'm-restricted', scope: { missionId: MISSION }, sensitivity: 'RESTRICTED' });
    expect(restricted.outcome).toBe('COMMITTED');
    const withRestricted = [...entities, (await handle.entity('m-restricted'))!];
    const coderGrant = defaultJuliusBrainReadGrant({ kind: 'WORKER', id: 'coder', role: 'CODING_AGENT', onBehalfOf: null, grantId: null }, BRAIN);
    const ids = juliusBrainSemanticCandidates({ retriever: createJuliusBrainHybridRetriever(), query: 'isolation incident', entities: withRestricted, grant: coderGrant, missionId: MISSION, limit: 5 });
    expect(ids).not.toContain('m-restricted');
    expect(ids[0]).toBe('r-isolation');
    const view = compileJuliusBrainContext(withRestricted, { missionId: MISSION, taskId: null, role: 'CODING_AGENT', grant: coderGrant, budgetCharacters: 50_000, asOf: '2026-09-13T11:00:00Z', semanticEntityIds: ['x-colours'] });
    const reasons = view.items.map((item) => item.reason);
    // x-colours is an ACTIVE decision, so structured retrieval already admitted it; SEMANTIC adds nothing twice.
    expect(reasons.filter((reason) => reason === 'SEMANTIC')).toEqual([]);
    expect(reasons.indexOf('MISSION_AUTHORITY')).toBeLessThan(reasons.lastIndexOf('DECISION'));
  });
});
