import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  PROJECT_BRAIN_ACTOR_KINDS, PROJECT_BRAIN_DELIVERER_KINDS, PROJECT_BRAIN_LIVE_STATUSES, PROJECT_BRAIN_RECORD_DOMAINS,
  PROJECT_BRAIN_RELATIONS, PROJECT_BRAIN_SCHEMA_V1, PROJECT_BRAIN_SCOPES, PROJECT_BRAIN_STATUSES,
  projectBrainForbiddenMaterial,
} from '../src/relay/mission/project-brain/project-brain';
import {
  PROJECT_BRAIN_SECTIONS, buildProjectBrainDocument, type PbRecordRow, type ProjectBrainRows,
} from '../src/relay/mission/project-brain/project-brain-document';

/**
 * THE PYTHON INTELLIGENCE LAYER, HELD TO THE TYPESCRIPT BRAIN IT READS.
 *
 * `python/julius_brain_intel` analyses the canonical Project Brain and the paid-run evidence; it is
 * not a second Brain. What keeps it honest is this file, run by Relay CI with the rest:
 *
 *   1. its whole unittest suite runs, and must run at least the cases it ships with;
 *   2. its mirrored vocabulary (sections, statuses, relations, actor and deliverer kinds, record
 *      domains, the schema version) equals the TypeScript constants, so a Brain change that the
 *      reader does not know about fails here instead of producing a confident mis-analysis;
 *   3. a document built by the REAL projection, `buildProjectBrainDocument`, parses in Python and
 *      round-trips its section counts, and the memory report runs over it;
 *   4. one corpus of secret-shaped and innocent strings gets the SAME verdict from the Brain's
 *      `projectBrainForbiddenMaterial` and the Python mirror -- the two layers cannot disagree
 *      about what a credential looks like.
 *
 * No Python on the runner is a FAILURE, never a skip: a cross-language contract that silently
 * stops running is exactly the vacuum this repository keeps finding.
 */

const PY_ROOT = resolve(__dirname, '..', 'python');
const MIN_CASES = 93;
const python = ['python3', 'python'].find((candidate) =>
  spawnSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 10)'], { encoding: 'utf8' }).status === 0);
const scratch = mkdtempSync(join(tmpdir(), 'julius-brain-intel-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function py(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(python!, args, { cwd: PY_ROOT, encoding: 'utf8', timeout: 300_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const T = (minute: number) => new Date(Date.UTC(2026, 9, 1, 12, minute)).toISOString();
const record = (over: Partial<PbRecordRow>): PbRecordRow => ({
  recordId: 'pbr:00000000-0000-4000-8000-000000000001', runId: null, scope: 'PROJECT', domain: 'REQUIREMENT', status: 'ADOPTED',
  title: 'Saves load in under two seconds.', body: '', subjectRef: null, version: 2, contentHash: 'a'.repeat(64),
  author: { kind: 'FOUNDER', id: 'founder' }, deliverer: { kind: 'OPERATOR_API', id: 'operator' }, createdAt: T(1), updatedAt: T(2), ...over,
});

function rows(): ProjectBrainRows {
  return {
    projectId: 'prj-contract', observedAt: T(30), cursor: { 'run:a': 3 }, runId: null, revision: 9, truncated: [],
    missions: [{
      runId: 'run:a', missionId: 'mission:a', state: 'EXECUTING', objective: 'Compare three save formats.', createdAt: T(0), updatedAt: T(10),
      cardRevision: 'card:1', contractRevision: 1, brainRevision: 5, lifecycleReason: null, lifecycleActor: null, lifecycleAt: null,
      policy: { executionMode: 'autonomous', reviewRequirement: 'independent', completionRule: 'all_blocking_criteria_and_independent_review',
        limits: { spendUsd: 2 }, requestedPermissions: ['read'], systemsInScope: [], systemsOutOfScope: [], workerRoles: ['CODING_AGENT'] },
    }],
    entries: [
      { entryId: 'run:a:objective', runId: 'run:a', taskId: null, workerId: 'relay-bootstrap', kind: 'CONSTRAINT', text: 'OBJECTIVE: Compare three save formats.', evidenceIds: [], revision: 1, createdAt: T(0) },
      { entryId: 'carried:run:b:brain:decision:x', runId: 'run:a', taskId: null, workerId: 'julius', kind: 'DECISION', text: 'Mission B verified the loader.', evidenceIds: ['ev-b'], revision: 2, createdAt: T(1) },
    ],
    criteria: [{ runId: 'run:a', criterionId: 'AC-1', description: 'The comparison exists.', ordinal: 0, passedEvidenceIds: ['ev-1'], linkedEvidenceIds: ['ev-1'] }],
    findings: [{ findingId: 'f-1', runId: 'run:a', taskId: 'run:a:build', reviewerWorkerId: 'reviewer-1', severity: 'HIGH', category: 'correctness',
      claim: 'Load time is not measured.', criterionId: 'AC-1', evidenceIds: ['ev-1'], blocking: true, status: 'OPEN', createdAt: T(8), updatedAt: T(8) }],
    evidence: [{ evidenceId: 'ev-1', runId: 'run:a', taskId: 'run:a:plan', workerId: 'architect-1', evidenceType: 'ARTIFACT', status: 'PASSED', summary: 'Plan written.', integrityHash: null, occurredAt: T(6), role: 'PROMPT_ARCHITECT' }],
    artifacts: [],
    decisions: [{ decisionId: 'd-1', runId: 'run:a', taskId: 'run:a:plan', action: 'ACCEPT', reasonCode: 'evidence_passed', summary: 'Plan accepted.', evidenceIds: ['ev-1'], policyRevision: 'p1', occurredAt: T(7) }],
    repairs: [], approvals: [], contracts: [], transitions: [], trajectory: [], claims: [], contexts: [], subagents: [],
    tasks: [{ taskId: 'run:a:plan', runId: 'run:a', role: 'PROMPT_ARCHITECT', taskType: 'plan', state: 'SUCCEEDED', updatedAt: T(7) }],
    records: [
      record({}),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000002', title: 'Saves load in under five seconds.', status: 'ADOPTED', version: 1, updatedAt: T(3) }),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000003', domain: 'INSTRUCTION', status: 'WITHDRAWN', title: 'An instruction taken back.', version: 1 }),
      record({ recordId: 'pbr:00000000-0000-4000-8000-000000000004', domain: 'DECISION', status: 'ACTIVE', title: 'Use a binary format.', scope: 'MISSION', runId: 'run:a', version: 1 }),
    ],
    links: [
      { linkId: 'lnk-1', fromRef: 'pbr:00000000-0000-4000-8000-000000000001', relation: 'SUPERSEDES', toRef: 'pbr:00000000-0000-4000-8000-000000000002', createdAt: T(4) },
      { linkId: 'lnk-2', fromRef: 'pbr:00000000-0000-4000-8000-000000000004', relation: 'CONTRADICTS', toRef: 'pbr:00000000-0000-4000-8000-000000000001', createdAt: T(5) },
    ],
    mutations: [], events: [], slots: [],
  };
}



describe('the Python intelligence layer, held to the TypeScript Brain', () => {
  it('a Python >= 3.10 is on the runner (absence fails, it is never skipped)', () => {
    expect(python, 'python3 or python >= 3.10 must be on PATH for the cross-language contract').toBeDefined();
  });

  it(`its unittest suite runs at least ${MIN_CASES} cases and passes`, () => {
    const result = py(['-m', 'unittest', 'discover', '-s', 'tests', '-t', 'tests']);
    const ran = Number(/Ran (\d+) tests?/.exec(result.stderr)?.[1] ?? 0);
    expect(ran, result.stderr.slice(-2000)).toBeGreaterThanOrEqual(MIN_CASES);
    expect(result.status, result.stderr.slice(-2000)).toBe(0);
    expect(result.stderr).toMatch(/\nOK\b/);
  }, 320_000);

  it('the mirrored vocabulary equals the TypeScript constants', () => {
    const result = py(['-m', 'julius_brain_intel', 'vocabulary']);
    expect(result.status, result.stderr).toBe(0);
    const vocabulary = JSON.parse(result.stdout) as Record<string, string[]>;
    expect(vocabulary).toEqual({
      schemaVersion: [PROJECT_BRAIN_SCHEMA_V1],
      sections: [...PROJECT_BRAIN_SECTIONS],
      statuses: [...PROJECT_BRAIN_STATUSES],
      liveStatuses: [...PROJECT_BRAIN_LIVE_STATUSES],
      relations: [...PROJECT_BRAIN_RELATIONS],
      scopes: [...PROJECT_BRAIN_SCOPES],
      actorKinds: [...PROJECT_BRAIN_ACTOR_KINDS],
      delivererKinds: [...PROJECT_BRAIN_DELIVERER_KINDS],
      recordDomains: [...PROJECT_BRAIN_RECORD_DOMAINS],
    });
  });

  it('a document built by the real projection parses in Python, counts round-trip, and the memory report runs', () => {
    const document = buildProjectBrainDocument(rows());
    const path = join(scratch, 'brain.json');
    writeFileSync(path, JSON.stringify(document));
    const checked = py(['-m', 'julius_brain_intel', 'brain-check', path]);
    expect(checked.status, checked.stderr).toBe(0);
    const summary = JSON.parse(checked.stdout) as { counts: Record<string, number>; revision: number; links: number };
    expect(summary.counts).toEqual(Object.fromEntries(PROJECT_BRAIN_SECTIONS.map((s) => [s, document.sections[s].length])));
    expect(summary.revision).toBe(document.revision);
    expect(summary.links).toBe(document.links.length);
    const memory = py(['-m', 'julius_brain_intel', 'memory', path, '--run', 'run:a']);
    expect(memory.status, memory.stderr).toBe(0);
    const report = JSON.parse(memory.stdout) as { schemaVersion: string; stale: { signal: string }[]; conflicts: { signal: string }[] };
    expect(report.schemaVersion).toBe('julius.memory-eval.v1');
    // Both signals come from typed links the projection carried: a live superseded requirement,
    // and a live decision contradicting a live requirement.
    expect(report.stale.map((f) => f.signal)).toContain('SUPERSEDED_LIVE');
    expect(report.conflicts.map((c) => c.signal)).toContain('CONTRADICTION_LINKED');
  });

  it('the Brain and the Python mirror give the same verdict on one corpus of secret-shaped and innocent text', () => {
    const corpus = [
      'src/relay/mission/julius/julius-task-contract.ts', 'julius-task-pipeline.ts', 'a desk-organiser-v2 note',
      'see sk-FAKETESTNOTREAL', 'my key is sk-ant-api03-FAKETESTNOTREAL', 'mykeysk-ant-api03-FAKETESTNOTREAL',
      'token ghp_FAKETESTNOTREALFAKETESTNOTREAL', 'github_pat_FAKETESTNOTREALFAKETEST', 'AKIAFAKETESTNOTREAL',
      'xoxb-FAKETESTNOTREAL', '-----BEGIN FAKETESTNOTREAL PRIVATE KEY-----', 'postgres://u:FAKETESTNOTREAL@h/db',
      'password: FAKETESTNOTREAL', 'my chain-of-thought was', '<thinking>', 'plain words about saves',
    ];
    const path = join(scratch, 'corpus.json');
    writeFileSync(path, JSON.stringify(corpus));
    const result = py(['-m', 'julius_brain_intel', 'safety-classify', path]);
    expect(result.status, result.stderr).toBe(0);
    const python = JSON.parse(result.stdout) as (string | null)[];
    const typescript = corpus.map((text) => projectBrainForbiddenMaterial(text));
    expect(python).toEqual(typescript);
    // And the boundary itself: file names are not keys, a key glued to a word is not a key, a key is.
    expect(typescript.slice(0, 3)).toEqual([null, null, null]);
    expect(typescript[5]).toBeNull();
    expect(typescript[4]).toBe('credential');
  });
});
