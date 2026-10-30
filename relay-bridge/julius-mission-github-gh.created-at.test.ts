/**
 * readWorkflowRun reads the matched run's `created_at` from the
 * `actions/runs/{id}/attempts/{n}` payload: the `workflowRunCreatedAt` that
 * /result checks against the recorded dispatch time. Fixture only: the `gh`
 * here is a recording fake, and the payload is a file in this repository.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createGhMissionGitHub, type GhReadRunner } from './julius-mission-github-gh';

const REPO = 'ohdieyuh-glitch/sunday-relay';
const RUN = '40250000001';
const PAYLOAD = readFileSync(join(__dirname, 'fixtures/actions-run-attempt-1.fixture.json'), 'utf8');

function runner(attempt: string): GhReadRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(args) {
      calls.push([...args]);
      if (args[0] === 'api' && args[3] === `repos/${REPO}/actions/runs/${RUN}/attempts/1`) return { code: 0, stdout: attempt, stderr: '' };
      if (args[0] === 'api' && args[3]?.endsWith('/jobs?per_page=100')) return { code: 0, stdout: '{"total_count":0,"jobs":[]}', stderr: '' };
      if (args[0] === 'api' && args[3]?.endsWith('/artifacts?per_page=100')) return { code: 0, stdout: '{"total_count":0,"artifacts":[]}', stderr: '' };
      return { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
    },
  };
}

const withCreatedAt = (value: unknown) => {
  const payload = JSON.parse(PAYLOAD) as Record<string, unknown>;
  if (value === undefined) delete payload.created_at; else payload.created_at = value;
  return JSON.stringify(payload);
};

describe('readWorkflowRun created_at, from an attempts payload fixture', () => {
  it('reads created_at from the attempt payload, with one GET of that path', async () => {
    const gh = runner(PAYLOAD);
    const run = await createGhMissionGitHub({ repo: REPO, runner: gh }).readWorkflowRun(RUN, '1');
    expect(run).toMatchObject({ workflowRunId: RUN, workflowRunAttempt: '1', headSha: '0123456789abcdef0123456789abcdef01234567', status: 'in_progress', conclusion: null });
    expect(run?.createdAt).toBe('2026-10-23T17:18:03Z');
    expect(run?.createdAt).not.toBe(JSON.parse(PAYLOAD).updated_at);
    // The fixture's run_started_at differs from created_at, so reading the wrong field fails here.
    expect(JSON.parse(PAYLOAD).run_started_at).not.toBe(JSON.parse(PAYLOAD).created_at);
    expect(run?.createdAt).not.toBe(JSON.parse(PAYLOAD).run_started_at);
    expect(gh.calls[0]).toEqual(['api', '-H', 'Accept: application/vnd.github+json', `repos/${REPO}/actions/runs/${RUN}/attempts/1`]);
    for (const args of gh.calls) expect(args).not.toContain('workflow');
  });

  it('a missing, non-string or malformed created_at is null, never a guess', async () => {
    for (const value of [undefined, null, 1729703883, '2026-10-23 17:18:03', '2026-10-23T17:18:03.123Z', 'yesterday']) {
      const run = await createGhMissionGitHub({ repo: REPO, runner: runner(withCreatedAt(value)) }).readWorkflowRun(RUN, '1');
      expect(run, String(value)).not.toBeNull();
      expect(run?.createdAt, String(value)).toBeNull();
    }
  });
});
