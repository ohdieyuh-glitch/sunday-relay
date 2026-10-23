/**
 * PRIOR RUNS OF THIS MISSION, FROM THIS JOB'S DATABASE.
 *
 * A query that throws is unreadable. Rows that come back are this database's
 * rows only. They are not the durable cross-job record, so every successful
 * read is marked `durableRecord: 'ABSENT'`.
 *
 * The qualifying-pair authorization does not use this read. It lists
 * `julius-run-spent-*` tags ({@link readJuliusSpentTagLedger}). An empty
 * result here stays absent prior-spend, not a verified zero.
 */

import {
  interpretJuliusSpentTags,
  summarizeJuliusPriorRunSpend,
  type JuliusSettlementFact,
  type JuliusSpentTag,
  type JuliusSpendLedgerRead,
} from '../../src/relay/mission/julius/julius-spend-ceiling';

export interface SqlQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Every other run of this mission in this project, with its `budget.settled`
 * facts folded by {@link summarizeJuliusPriorRunSpend}. The run about to be
 * created is not in the table yet; pass `excludeRunId` when one already is.
 */
export async function readJuliusPriorRunSpend(
  pool: SqlQueryable,
  input: { readonly missionId: string; readonly projectId: string; readonly excludeRunId?: string },
): Promise<JuliusSpendLedgerRead> {
  try {
    const runs = await pool.query<{ run_id: string }>(
      `SELECT run_id FROM relay_wonderland.julius_runs
        WHERE mission_id=$1 AND project_id=$2 AND run_id <> $3
        ORDER BY created_at, run_id`,
      [input.missionId, input.projectId, input.excludeRunId ?? ''],
    );
    const runIds = runs.rows.map((row) => row.run_id).filter((id) => typeof id === 'string' && id !== '');
    if (runIds.length === 0) return { readable: true, priorRuns: [], durableRecord: 'ABSENT' };
    const settled = await pool.query<{ run_id: string; task_id: string | null; facts: unknown }>(
      `SELECT stream_id AS run_id, payload->>'taskId' AS task_id, payload->'facts' AS facts
         FROM relay_wonderland.events
        WHERE project_id=$1 AND event_type='julius.budget.settled' AND stream_id = ANY($2::text[])
        ORDER BY stream_id, sequence`,
      [input.projectId, runIds],
    );
    const byRun = new Map<string, JuliusSettlementFact[]>();
    for (const runId of runIds) byRun.set(runId, []);
    for (const row of settled.rows) {
      const facts = asRecord(row.facts);
      const list = byRun.get(row.run_id);
      if (list === undefined) continue;
      list.push({
        taskId: typeof row.task_id === 'string' && row.task_id !== '' ? row.task_id : row.run_id,
        role: typeof facts.role === 'string' ? facts.role : null,
        basis: facts.costBasis,
        usdMicros: facts.usdMicros,
        estimatedUsdMicros: facts.estimatedUsdMicros,
        billingPath: facts.billingPath,
      });
    }
    const priorRuns = runIds.map((runId) => summarizeJuliusPriorRunSpend(runId, byRun.get(runId) ?? []));
    return { readable: true, priorRuns, durableRecord: 'ABSENT' };
  } catch {
    return { readable: false };
  }
}

const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const TAG_OBJECT_SHA = /^[0-9a-f]{40}$/u;

/**
 * THE DURABLE PRIOR-SPEND RECORD.
 *
 * Lists `refs/tags/julius-run-spent-*` with the job token and reads each
 * annotated body. Contents: read is enough. A missing token, a missing
 * repository, a non-success response, a page past the follow cap, or a
 * thrown fetch is unreadable. The token is a header and is not copied into
 * the ledger. The current run's own tag is excluded by {@link interpretJuliusSpentTags}.
 */
export async function readJuliusSpentTagLedger(input: {
  readonly repository: string;
  readonly token: string;
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<JuliusSpendLedgerRead> {
  if (!GITHUB_REPOSITORY.test(input.repository)) return { readable: false };
  if (input.token.trim() === '' || /[\r\n]/u.test(input.token) || input.token.length > 512) {
    return { readable: false };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sunday-relay',
  };
  try {
    const tags: JuliusSpentTag[] = [];
    let url: string | null = `https://api.github.com/repos/${input.repository}/git/matching-refs/tags/julius-run-spent-`;
    let pages = 0;
    while (url !== null) {
      if (pages === 5) return { readable: false };
      pages += 1;
      const response = await fetchImpl(url, { headers });
      if (!response.ok) return { readable: false };
      const body: unknown = await response.json();
      if (!Array.isArray(body)) return { readable: false };
      for (const entry of body) {
        const tag = await readOneSpentTag(entry, input.repository, headers, fetchImpl);
        if (tag === 'unreadable') return { readable: false };
        tags.push(tag);
      }
      const next = nextGitHubPage(response.headers.get('link'));
      if (next === 'rejected') return { readable: false };
      url = next;
    }
    return interpretJuliusSpentTags({
      namespace: input.namespace,
      excludeRunId: input.excludeRunId,
      tags,
    });
  } catch {
    return { readable: false };
  }
}

async function readOneSpentTag(
  entry: unknown,
  repository: string,
  headers: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch,
): Promise<JuliusSpentTag | 'unreadable'> {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return 'unreadable';
  const record = entry as Record<string, unknown>;
  if (typeof record.ref !== 'string') return 'unreadable';
  const object = record.object;
  if (object === null || typeof object !== 'object' || Array.isArray(object)) return 'unreadable';
  const typed = object as Record<string, unknown>;
  if (typed.type === 'commit') return { ref: record.ref, message: null };
  if (typed.type !== 'tag' || typeof typed.sha !== 'string' || !TAG_OBJECT_SHA.test(typed.sha)) {
    return 'unreadable';
  }
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/git/tags/${typed.sha}`,
    { headers },
  );
  if (!response.ok) return 'unreadable';
  const body: unknown = await response.json();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'unreadable';
  const message = (body as Record<string, unknown>).message;
  if (typeof message !== 'string') return 'unreadable';
  return { ref: record.ref, message };
}

function nextGitHubPage(header: string | null): string | null | 'rejected' {
  if (header === null || header === '') return null;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/u.exec(part);
    if (match === null) continue;
    const next = match[1] ?? '';
    if (!next.startsWith('https://api.github.com/')) return 'rejected';
    return next;
  }
  return null;
}
