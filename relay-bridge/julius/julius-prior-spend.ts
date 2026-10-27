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

import { inflateRawSync } from 'node:zlib';

import {
  classifyJuliusPriorRun,
  classifyJuliusSpentTags,
  juliusAttemptMarkerBindings,
  juliusBoundArtifactId,
  juliusSpentTagBinding,
  parseJuliusAttemptRecordTag,
  JULIUS_RUN_RECORD_TAG_PREFIX,
  JULIUS_INWORLD_VERDICT_ARTIFACT,
  JULIUS_INWORLD_VERDICT_FILE,
  JULIUS_LIVE_EVIDENCE_ARTIFACT,
  JULIUS_EVIDENCE_MANIFEST_FILE,
  JULIUS_ZERO_ROW_EVIDENCE_FILES,
  summarizeJuliusPriorRunSpend,
  type JuliusPriorRunAudit,
  type JuliusPriorRunObservation,
  type JuliusPriorRunProof,
  type JuliusWorkflowRunBinding,
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
 * the ledger. The current run's own tag is excluded by {@link classifyJuliusSpentTags}.
 *
 * Each verified tag's own workflow run is then read ({@link observeJuliusWorkflowRun})
 * and classified NOT_EXECUTED, EXECUTED_CHARGES_KNOWN or UNKNOWN. A read
 * that fails for one run leaves that run UNKNOWN at its full reservation;
 * it does not make the ledger unreadable and it never makes the run zero.
 * Actions: read is what those reads need, beside Contents: read.
 */
export async function readJuliusClassifiedSpentTags(input: {
  readonly repository: string;
  readonly token: string;
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ readonly ledger: JuliusSpendLedgerRead; readonly audit: readonly JuliusPriorRunAudit[] }> {
  const unreadable = { ledger: { readable: false } as const, audit: [] };
  if (!GITHUB_REPOSITORY.test(input.repository)) return unreadable;
  if (!tokenIsUsable(input.token)) return unreadable;
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = githubHeaders(input.token);
  let tags: JuliusSpentTag[];
  try {
    tags = [];
    let url: string | null = `https://api.github.com/repos/${input.repository}/git/matching-refs/tags/julius-run-spent-`;
    let pages = 0;
    while (url !== null) {
      if (pages === 5) return unreadable;
      pages += 1;
      const response = await fetchImpl(url, { headers });
      if (!response.ok) return unreadable;
      const body: unknown = await response.json();
      if (!Array.isArray(body)) return unreadable;
      for (const entry of body) {
        const tag = await readOneSpentTag(entry, input.repository, headers, fetchImpl);
        if (tag === 'unreadable') return unreadable;
        tags.push(tag);
      }
      const next = nextGitHubPage(response.headers.get('link'));
      if (next === 'rejected') return unreadable;
      url = next;
    }
  } catch {
    return unreadable;
  }
  const base = { namespace: input.namespace, excludeRunId: input.excludeRunId, tags };
  const first = classifyJuliusSpentTags(base);
  if (!first.ledger.readable) return first;
  const proofs = new Map<string, JuliusPriorRunProof>();
  for (const entry of first.audit) {
    if (entry.basis !== 'proof_absent' || entry.workflowRunId === null || entry.workflowRunAttempt === null) continue;
    const binding = bindingOf(tags, entry);
    if (binding === null) continue;
    const observation = await observeJuliusWorkflowRun({
      repository: input.repository, headers, fetchImpl, binding, juliusRunId: entry.runId,
    });
    proofs.set(entry.runId, classifyJuliusPriorRun(observation, entry.runId));
  }
  return classifyJuliusSpentTags({ ...base, proofs });
}

/** The ledger the cap counts. One reader: {@link readJuliusClassifiedSpentTags}. */
export async function readJuliusSpentTagLedger(input: {
  readonly repository: string;
  readonly token: string;
  readonly namespace: string;
  readonly excludeRunId?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<JuliusSpendLedgerRead> {
  return (await readJuliusClassifiedSpentTags(input)).ledger;
}

/**
 * THE ATTEMPTED MARKERS, on the same proofs. Lists `<namespace>-attempted`
 * artifacts repository-wide AND the `julius-run-record-<suffix>-attempted`
 * tags (X′ §2: the tag is the durable record, the artifact best-effort), and
 * classifies the run behind each one once: a run named by both is one entry
 * (`workflowRunId` + `headSha`). Either listing failing is unreadable, never
 * zero. A record tag of this namespace whose body cannot bind a run counts,
 * UNKNOWN.
 */
export async function readJuliusAttemptMarkers(input: {
  readonly repository: string;
  readonly token: string;
  readonly namespace: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ readonly readable: false } | { readonly readable: true; readonly proofs: readonly JuliusPriorRunProof[] }> {
  if (!GITHUB_REPOSITORY.test(input.repository) || !tokenIsUsable(input.token)) return { readable: false };
  if (!/^[a-z][a-z0-9-]{2,48}$/u.test(input.namespace)) return { readable: false };
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = githubHeaders(input.token);
  const markerName = `${input.namespace}-attempted`;
  const listing = await readJson(
    fetchImpl,
    `https://api.github.com/repos/${input.repository}/actions/artifacts?name=${markerName}&per_page=100`,
    headers,
  );
  const artifactBindings = juliusAttemptMarkerBindings(listing, markerName);
  if (artifactBindings === null) return { readable: false };
  // THE SECOND SOURCE (X′ §2): the attempted record tags. Either listing unreadable is unreadable.
  const records = await readJuliusAttemptRecordTags({ repository: input.repository, headers, fetchImpl, namespace: input.namespace });
  if (records === null) return { readable: false };
  const bindings = [...artifactBindings, ...records.bindings];
  const proofs: JuliusPriorRunProof[] = [...records.unbound];
  const seen = new Set<string>();
  for (const binding of bindings) {
    const key = `${binding.workflowRunId}\t${binding.headSha}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A marker names no admission run id, so no cost row can match it:
    // an executed marker is UNKNOWN or counted, never charges-known zero.
    const observation = await observeJuliusWorkflowRun({
      repository: input.repository, headers, fetchImpl, binding, juliusRunId: '',
    });
    proofs.push(classifyJuliusPriorRun(observation, ''));
  }
  return { readable: true, proofs };
}

/** The binding a counted record tag gets when its body cannot name a run: UNKNOWN, printed as such. */
const UNBOUND_RECORD: JuliusWorkflowRunBinding = Object.freeze({ workflowRunId: 'UNKNOWN', workflowRunAttempt: 'UNKNOWN', headSha: 'UNKNOWN' });

/**
 * `git/matching-refs/tags/julius-run-record-`, the `-attempted` refs only, each
 * annotated body parsed by {@link parseJuliusAttemptRecordTag}. Null when the
 * listing, a page, or any ref it must attribute cannot be read. The spent-tag
 * listing never sees these refs: its prefix is `julius-run-spent-`.
 */
async function readJuliusAttemptRecordTags(input: {
  readonly repository: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetchImpl: typeof fetch;
  readonly namespace: string;
}): Promise<{ readonly bindings: readonly JuliusWorkflowRunBinding[]; readonly unbound: readonly JuliusPriorRunProof[] } | null> {
  const bindings: JuliusWorkflowRunBinding[] = [];
  const unbound: JuliusPriorRunProof[] = [];
  try {
    let url: string | null = `https://api.github.com/repos/${input.repository}/git/matching-refs/tags/julius-run-record-`;
    let pages = 0;
    while (url !== null) {
      if (pages === 5) return null;
      pages += 1;
      const response = await input.fetchImpl(url, { headers: input.headers });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      if (!Array.isArray(body)) return null;
      for (const entry of body) {
        const ref = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>).ref : undefined;
        if (typeof ref !== 'string') return null;
        // The result record is not an attempt; its body is not fetched here.
        if (ref.startsWith(JULIUS_RUN_RECORD_TAG_PREFIX) && !ref.endsWith('-attempted')) continue;
        const tag = await readOneSpentTag(entry, input.repository, input.headers, input.fetchImpl);
        if (tag === 'unreadable') return null;
        const parsed = parseJuliusAttemptRecordTag(tag.ref, tag.message, input.namespace);
        if (parsed.kind === 'unreadable') return null;
        if (parsed.kind === 'bound') bindings.push(parsed.binding);
        if (parsed.kind === 'counted_unbound') {
          unbound.push({ binding: UNBOUND_RECORD, classification: 'UNKNOWN', basis: parsed.basis, knownChargesUsdMicros: null });
        }
      }
      const next = nextGitHubPage(response.headers.get('link'));
      if (next === 'rejected') return null;
      url = next;
    }
  } catch {
    return null;
  }
  return { bindings, unbound };
}

function bindingOf(tags: readonly JuliusSpentTag[], entry: JuliusPriorRunAudit): JuliusWorkflowRunBinding | null {
  const tag = tags.find((candidate) => candidate.message?.trim().split('\n')[1] === `run=${entry.runId}`);
  const binding = tag === undefined ? null : juliusSpentTagBinding(tag.message);
  if (binding === null || binding.workflowRunId !== entry.workflowRunId || binding.workflowRunAttempt !== entry.workflowRunAttempt) {
    return null;
  }
  return binding;
}

function tokenIsUsable(token: string): boolean {
  return token.trim() !== '' && !/[\r\n]/u.test(token) && token.length <= 512;
}

function githubHeaders(token: string): Readonly<Record<string, string>> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sunday-relay',
  };
}

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<unknown> {
  try {
    const response = await fetchImpl(url, { headers });
    if (!response.ok) return null;
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

/**
 * Everything one classification needs, read from GitHub for exactly the run
 * and attempt the binding names. Each read that fails is null. The evidence
 * zips are fetched only when proof (a) does not already hold.
 */
export async function observeJuliusWorkflowRun(input: {
  readonly repository: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetchImpl: typeof fetch;
  readonly binding: JuliusWorkflowRunBinding;
  readonly juliusRunId: string;
}): Promise<JuliusPriorRunObservation> {
  const { binding, fetchImpl, headers } = input;
  const runUrl = `https://api.github.com/repos/${input.repository}/actions/runs/${binding.workflowRunId}`;
  const empty: JuliusPriorRunObservation = { binding, run: null, jobs: null, artifacts: null, liveEvidence: null, verdict: null };
  if (!/^[1-9][0-9]{0,19}$/u.test(binding.workflowRunId) || !/^[1-9][0-9]{0,9}$/u.test(binding.workflowRunAttempt)) return empty;
  const run = await readJson(fetchImpl, runUrl, headers);
  const jobs = await readJson(fetchImpl, `${runUrl}/attempts/${binding.workflowRunAttempt}/jobs?per_page=100`, headers);
  const shallow: JuliusPriorRunObservation = { ...empty, run, jobs };
  // Proof (a) decided it, or the run itself could not be bound: no artifact can change that.
  if (classifyJuliusPriorRun(shallow, input.juliusRunId).basis !== 'evidence_unreadable') return shallow;
  const artifacts = await readJson(fetchImpl, `${runUrl}/artifacts?per_page=100`, headers);
  const evidenceId = juliusBoundArtifactId(artifacts, JULIUS_LIVE_EVIDENCE_ARTIFACT, binding);
  const verdictId = juliusBoundArtifactId(artifacts, JULIUS_INWORLD_VERDICT_ARTIFACT, binding);
  const liveEvidence = evidenceId === null
    ? null
    : await readArtifactFiles(input.repository, evidenceId, headers, fetchImpl, [JULIUS_EVIDENCE_MANIFEST_FILE, ...JULIUS_ZERO_ROW_EVIDENCE_FILES]);
  const verdict = verdictId === null
    ? null
    : await readArtifactFiles(input.repository, verdictId, headers, fetchImpl, [JULIUS_INWORLD_VERDICT_FILE]);
  return { binding, run, jobs, artifacts, liveEvidence, verdict };
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

const ARTIFACT_ZIP_MAX_BYTES = 64 * 1024 * 1024;
const ARTIFACT_FILE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * The named files of one artifact, or null. GitHub answers the zip request
 * with a redirect to a signed URL; it is followed by hand, over https, and
 * WITHOUT the token, so the credential never leaves api.github.com.
 */
async function readArtifactFiles(
  repository: string,
  artifactId: number,
  headers: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch,
  names: readonly string[],
): Promise<ReadonlyMap<string, string> | null> {
  try {
    let response = await fetchImpl(
      `https://api.github.com/repos/${repository}/actions/artifacts/${String(artifactId)}/zip`,
      { headers, redirect: 'manual' },
    );
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null || !location.startsWith('https://')) return null;
      response = await fetchImpl(location, { headers: { 'User-Agent': 'sunday-relay' } });
    }
    if (!response.ok) return null;
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > ARTIFACT_ZIP_MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > ARTIFACT_ZIP_MAX_BYTES) return null;
    return readZipTextFiles(bytes, names);
  } catch {
    return null;
  }
}

/**
 * A minimal, strict zip reader for the entries named. Stored and deflated
 * entries only; zip64, encryption, a duplicate name, a size that disagrees,
 * or bytes that are not UTF-8 make the whole read null. A name that is not in
 * the archive is simply absent from the map, and the classifier decides.
 */
export function readZipTextFiles(bytes: Uint8Array, names: readonly string[]): ReadonlyMap<string, string> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wanted = new Set(names);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 0xffff; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const seen = new Set<string>();
  const files = new Map<string, string>();
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return null;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > bytes.length) return null;
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (seen.has(name)) return null;
    seen.add(name);
    if (!wanted.has(name)) continue;
    if ((flags & 0x1) !== 0 || compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) return null;
    if (size > ARTIFACT_FILE_MAX_BYTES) return null;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return null;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > bytes.length) return null;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    let content: Uint8Array;
    if (method === 0) content = data;
    else if (method === 8) content = inflateRawSync(data, { maxOutputLength: ARTIFACT_FILE_MAX_BYTES });
    else return null;
    if (content.length !== size) return null;
    files.set(name, decoder.decode(content));
  }
  return files;
}
