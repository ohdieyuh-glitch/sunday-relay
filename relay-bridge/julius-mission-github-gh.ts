/**
 * READ-ONLY GITHUB, THROUGH THE FOUNDER'S OWN `gh`.
 *
 * The Wonderland bridge runs on the founder's laptop beside the game client.
 * It holds no GitHub token: every read here is `gh api` (or `gh run download`)
 * under the founder's existing `gh` login. Nothing here writes to GitHub, and
 * nothing here can dispatch a workflow: the only argvs it builds are GETs from
 * a closed list, each assembled from ids that were validated first.
 *
 * It serves two readers:
 * - `JuliusMissionGitHub`, for YUJI's evidence reader (the spent tag and the
 *   finished run's artifacts, and X′'s result record tag), so /result and
 *   /progress can reach completed;
 * - `JuliusRunJobsReader`, for the live events route (the run and its jobs'
 *   step states while it executes).
 *
 * A failure to read is `null` or a thrown `github_unreadable`, never a guess.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import type {
  JuliusMissionGitHub,
  JuliusMissionWorkflowArtifact,
  JuliusMissionWorkflowArtifactFile,
  JuliusMissionWorkflowRun,
} from './julius-mission-evidence-reader';
import { EVIDENCE_ARTIFACT, VERDICT_ARTIFACT } from './julius-mission-evidence-reader';

/** One `gh` invocation. The production runner (wonderland-live-wiring.ts) starts `gh`; tests pass a fake. */
export interface GhReadRunner {
  run(args: readonly string[]): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
}

/** One step of one job, as GitHub reports it. Names and states only. */
export interface JuliusRunStep {
  readonly number: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface JuliusRunJob {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly steps: readonly JuliusRunStep[];
}

/** The run fields the live route binds on. */
export interface JuliusRunSummary {
  readonly id: string;
  readonly attempt: number;
  readonly status: string;
  readonly conclusion: string | null;
  readonly event: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly path: string;
  readonly displayTitle: string;
  readonly createdAt: string | null;
}

/** One commit status, as GitHub reports it. The live route filters these by context, creator and grammar. */
export interface JuliusCommitStatus {
  readonly id: string;
  readonly context: string;
  readonly state: string;
  readonly description: string;
  readonly creator: string;
  readonly createdAt: string | null;
  /** The status's target_url, for the result record's run binding (X′ §4). Null when absent. */
  readonly targetUrl?: string | null;
}

export interface JuliusRunJobsReader {
  readRun(workflowRunId: string): Promise<JuliusRunSummary | null>;
  readRunJobs(workflowRunId: string, attempt: number): Promise<readonly JuliusRunJob[] | null>;
  readCommitStatuses(sha: string): Promise<readonly JuliusCommitStatus[] | null>;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const ATTEMPT = /^[1-9][0-9]{0,4}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
/** The spent tag, and (X′ §4) the result record tag. No other ref is read. */
const SPENT_TAG_REF = /^refs\/tags\/(julius-run-spent-(?:[0-9a-f]{24}|[0-9a-f]{32})|julius-run-record-(?:[0-9a-f]{24}|[0-9a-f]{32})-result)$/u;
const ARTIFACT_NAME = /^[A-Za-z0-9._-]{1,120}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const NAME_MAX = 300;

/** The evidence reader reads these artifacts and no others; their bytes are fetched only for a finished run. The names are the reader's own
 * constants, so the two cannot drift apart: a hand-typed 'julius-inworld-grade' here once meant the grade job's verdict was never downloaded. */
export const EVIDENCE_ARTIFACT_NAMES: ReadonlySet<string> = new Set([EVIDENCE_ARTIFACT, VERDICT_ARTIFACT]);
const COMPLETED_MARKER = /^[a-z][a-z0-9-]{2,48}-completed$/u;
/** Bound on the bytes one finished run's artifacts may bring into the bridge. */
export const ARTIFACT_BYTES_MAX = 32 * 1024 * 1024;

export class GithubUnreadableError extends Error {
  constructor() {
    super('github_unreadable');
    this.name = 'GithubUnreadableError';
  }
}

export interface GhMissionGitHubOptions {
  readonly repo: string;
  readonly runner: GhReadRunner;
  /** Where `gh run download` unpacks, one fresh directory per read, removed after. */
  readonly scratchRoot?: string;
}

export function createGhMissionGitHub(options: GhMissionGitHubOptions): JuliusMissionGitHub & JuliusRunJobsReader {
  if (!REPO.test(options.repo)) throw new Error('github_repo_invalid');
  const repo = options.repo;
  const api = async (path: string): Promise<unknown> => {
    const result = await options.runner.run(['api', '-H', 'Accept: application/vnd.github+json', path]);
    if (result.code !== 0) {
      if (/HTTP 404|Not Found/u.test(result.stderr)) return null;
      throw new GithubUnreadableError();
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new GithubUnreadableError();
    }
  };

  const readRun = async (workflowRunId: string): Promise<JuliusRunSummary | null> => {
    if (!RUN_ID.test(workflowRunId)) return null;
    return runSummary(await api(`repos/${repo}/actions/runs/${workflowRunId}`));
  };

  const readRunJobs = async (workflowRunId: string, attempt: number): Promise<readonly JuliusRunJob[] | null> => {
    if (!RUN_ID.test(workflowRunId) || !ATTEMPT.test(String(attempt))) return null;
    const body = record(await api(`repos/${repo}/actions/runs/${workflowRunId}/attempts/${attempt}/jobs?per_page=100`));
    if (body === null || !Array.isArray(body.jobs)) return null;
    const jobs: JuliusRunJob[] = [];
    for (const raw of body.jobs) {
      const job = runJob(raw);
      if (job === null) return null;
      jobs.push(job);
    }
    return jobs;
  };

  const readCommitStatuses = async (sha: string): Promise<readonly JuliusCommitStatus[] | null> => {
    if (!SHA40.test(sha)) return null;
    const body = await api(`repos/${repo}/commits/${sha}/statuses?per_page=100`);
    if (!Array.isArray(body)) return null;
    const statuses: JuliusCommitStatus[] = [];
    for (const raw of body) {
      const status = commitStatus(raw);
      if (status !== null) statuses.push(status);
    }
    return statuses;
  };

  return {
    readRun,
    readRunJobs,
    readCommitStatuses,

    async readAnnotatedTagMessage(tagRef) {
      const name = SPENT_TAG_REF.exec(tagRef)?.[1];
      if (name === undefined) return null;
      const ref = record(await api(`repos/${repo}/git/ref/tags/${name}`));
      if (ref === null) return null;
      const object = record(ref.object);
      if (object === null || object.type !== 'tag' || typeof object.sha !== 'string' || !SHA40.test(object.sha)) return null;
      const tag = record(await api(`repos/${repo}/git/tags/${object.sha}`));
      return tag !== null && typeof tag.message === 'string' ? tag.message : null;
    },

    async readWorkflowRun(workflowRunId, workflowRunAttempt) {
      if (!RUN_ID.test(workflowRunId) || !ATTEMPT.test(workflowRunAttempt)) return null;
      const run = record(await api(`repos/${repo}/actions/runs/${workflowRunId}/attempts/${workflowRunAttempt}`));
      if (run === null) return null;
      const status = run.status;
      const conclusion = run.conclusion;
      if (typeof run.head_sha !== 'string' || !SHA40.test(run.head_sha) || typeof status !== 'string') return null;
      const jobs = await readRunJobs(workflowRunId, Number(workflowRunAttempt)) ?? [];
      const failedSteps = jobs.flatMap((job) => job.steps.filter((step) => step.conclusion === 'failure').map((step) => step.name));
      const finished = status === 'completed';
      const listed = record(await api(`repos/${repo}/actions/runs/${workflowRunId}/artifacts?per_page=100`));
      const artifacts: JuliusMissionWorkflowArtifact[] = [];
      let budget = ARTIFACT_BYTES_MAX;
      for (const raw of Array.isArray(listed?.artifacts) ? listed.artifacts : []) {
        const artifact = record(raw);
        const artifactName = typeof artifact?.name === 'string' ? artifact.name : '';
        if (!ARTIFACT_NAME.test(artifactName) || artifact?.expired === true) continue;
        if (!EVIDENCE_ARTIFACT_NAMES.has(artifactName) && !COMPLETED_MARKER.test(artifactName)) continue;
        const size = typeof artifact?.size_in_bytes === 'number' ? artifact.size_in_bytes : Number.POSITIVE_INFINITY;
        if (!finished || size > budget) {
          artifacts.push({ name: artifactName, files: null });
          continue;
        }
        budget -= size;
        artifacts.push({ name: artifactName, files: await downloadArtifact(options, repo, workflowRunId, artifactName) });
      }
      return {
        workflowRunId,
        workflowRunAttempt,
        headSha: run.head_sha,
        createdAt: typeof run.created_at === 'string' && ISO.test(run.created_at) ? run.created_at : null,
        status,
        conclusion: typeof conclusion === 'string' ? conclusion : null,
        failedSteps,
        artifacts,
      } as unknown as JuliusMissionWorkflowRun;
    },
  };
}

/** `gh run download` into a fresh directory; the files are read, bounded, and the directory removed. */
async function downloadArtifact(
  options: GhMissionGitHubOptions,
  repo: string,
  workflowRunId: string,
  name: string,
): Promise<readonly JuliusMissionWorkflowArtifactFile[] | null> {
  const dir = mkdtempSync(join(options.scratchRoot ?? tmpdir(), 'julius-artifact-'));
  try {
    const result = await options.runner.run(['run', 'download', workflowRunId, '--repo', repo, '--name', name, '--dir', dir]);
    if (result.code !== 0) return null;
    const files: JuliusMissionWorkflowArtifactFile[] = [];
    let total = 0;
    const walk = (at: string): boolean => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = join(at, entry.name);
        if (entry.isSymbolicLink()) return false;
        if (entry.isDirectory()) {
          if (!walk(full)) return false;
          continue;
        }
        if (!entry.isFile()) return false;
        total += statSync(full).size;
        if (total > ARTIFACT_BYTES_MAX) return false;
        files.push({ path: relative(dir, full).split('\\').join('/'), text: readFileSync(full, 'utf8') });
      }
      return true;
    };
    return walk(dir) ? files.sort((a, b) => a.path.localeCompare(b.path)) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runSummary(value: unknown): JuliusRunSummary | null {
  const run = record(value);
  if (run === null) return null;
  const id = typeof run.id === 'number' && Number.isSafeInteger(run.id) ? String(run.id) : '';
  const attempt = run.run_attempt;
  if (!RUN_ID.test(id) || typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 1) return null;
  if (typeof run.status !== 'string' || typeof run.event !== 'string' || typeof run.head_branch !== 'string') return null;
  if (typeof run.head_sha !== 'string' || !SHA40.test(run.head_sha) || typeof run.path !== 'string') return null;
  const title = typeof run.display_title === 'string' ? run.display_title : '';
  return {
    id,
    attempt,
    status: run.status,
    conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    path: run.path,
    displayTitle: title,
    createdAt: typeof run.created_at === 'string' && ISO.test(run.created_at) ? run.created_at : null,
  };
}

function runJob(value: unknown): JuliusRunJob | null {
  const job = record(value);
  if (job === null) return null;
  const id = typeof job.id === 'number' && Number.isSafeInteger(job.id) ? String(job.id) : '';
  if (!RUN_ID.test(id) || !boundedName(job.name) || typeof job.status !== 'string') return null;
  const steps: JuliusRunStep[] = [];
  for (const raw of Array.isArray(job.steps) ? job.steps : []) {
    const step = record(raw);
    if (step === null || typeof step.number !== 'number' || !Number.isSafeInteger(step.number)) return null;
    if (!boundedName(step.name) || typeof step.status !== 'string') return null;
    steps.push({
      number: step.number,
      name: step.name,
      status: step.status,
      conclusion: typeof step.conclusion === 'string' ? step.conclusion : null,
      startedAt: isoOrNull(step.started_at),
      completedAt: isoOrNull(step.completed_at),
    });
  }
  return {
    id,
    name: job.name,
    status: job.status,
    conclusion: typeof job.conclusion === 'string' ? job.conclusion : null,
    startedAt: isoOrNull(job.started_at),
    completedAt: isoOrNull(job.completed_at),
    steps,
  };
}

function commitStatus(value: unknown): JuliusCommitStatus | null {
  const status = record(value);
  if (status === null) return null;
  const id = typeof status.id === 'number' && Number.isSafeInteger(status.id) ? String(status.id) : '';
  const creator = record(status.creator);
  if (!RUN_ID.test(id) || !boundedName(status.context) || typeof status.state !== 'string') return null;
  return {
    id,
    context: status.context,
    state: status.state,
    description: typeof status.description === 'string' ? status.description.slice(0, 200) : '',
    creator: typeof creator?.login === 'string' ? creator.login : '',
    createdAt: isoOrNull(status.created_at),
    targetUrl: typeof status.target_url === 'string' && status.target_url.length <= 500 ? status.target_url : null,
  };
}

function boundedName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= NAME_MAX;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && ISO.test(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
