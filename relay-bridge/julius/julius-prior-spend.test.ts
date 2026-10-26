import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  authorizeJuliusLiveSpend,
  classifyJuliusPriorRun,
  classifyJuliusSpentTags,
  juliusAttemptMarkerLine,
  juliusPriorRunLine,
  juliusSpentTagMessage,
  type JuliusPriorRunAudit,
} from '../../src/relay/mission/julius/julius-spend-ceiling';
import { claimJuliusAdmissionSpend } from '../../src/relay/mission/julius/julius-spent-tag-record';
import {
  readJuliusAttemptMarkers,
  readJuliusClassifiedSpentTags,
  readJuliusPriorRunSpend,
  readJuliusSpentTagLedger,
  readZipTextFiles,
  type SqlQueryable,
} from './julius-prior-spend';
import { attemptMarkersCommand, authorizeSpendCommand } from '../julius-live-mission';

function pool(handler: (sql: string, values: readonly unknown[] | undefined) => { rows: Record<string, unknown>[] }): SqlQueryable {
  return {
    async query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
      return handler(sql, values) as { rows: T[] };
    },
  };
}

describe('prior spend is read from the durable ledger or reported unreadable', () => {
  it('an empty local database is an absent durable record, not a verified zero', async () => {
    const result = await readJuliusPriorRunSpend(pool(() => ({ rows: [] })), {
      missionId: 'julius-live-mission-5', projectId: 'project-1',
    });
    expect(result).toEqual({ readable: true, priorRuns: [], durableRecord: 'ABSENT' });
  });

  it('folds settled API bills and leaves a run with no settlements unverified', async () => {
    const result = await readJuliusPriorRunSpend(pool((sql) => {
      if (sql.includes('julius_runs')) return { rows: [{ run_id: 'run-billed' }, { run_id: 'run-empty' }] };
      return {
        rows: [{
          run_id: 'run-billed', task_id: 'build-1',
          facts: { role: 'CODING_AGENT', costBasis: 'PROVIDER_REPORTED', usdMicros: 2_000_000, billingPath: 'API_BILLED' },
        }],
      };
    }), { missionId: 'm', projectId: 'p' });
    expect(result.readable).toBe(true);
    if (!result.readable) return;
    expect(result.priorRuns).toEqual([
      { runId: 'run-billed', knownUsdMicros: 2_000_000, unknownCostComponents: 0, unverifiableApiSpend: false, spendVerified: true },
      { runId: 'run-empty', knownUsdMicros: 0, unknownCostComponents: 0, unverifiableApiSpend: false, spendVerified: false },
    ]);
  });

  it('a thrown query is unreadable, not an empty history', async () => {
    const result = await readJuliusPriorRunSpend({
      query: async () => { throw new Error('connection refused'); },
    }, { missionId: 'm', projectId: 'p' });
    expect(result).toEqual({ readable: false });
  });

  it('the live entry authorizes spend before it creates a run or assembles the runtime', () => {
    const entry = readFileSync('relay-bridge/julius-live-mission.ts', 'utf8');
    const authorize = entry.indexOf('const spendAuthorization = qualifyingPair');
    const create = entry.indexOf('const submitted = await bootstrap.submit(request)');
    const assemble = entry.indexOf('const runtime = assembleLiveJuliusRuntime(');
    expect(authorize).toBeGreaterThan(-1);
    expect(authorize).toBeLessThan(create);
    expect(create).toBeLessThan(assemble);
    const tags = entry.indexOf('await authorizeQualifyingPairSpend({ contract, env, out })');
    expect(tags).toBeGreaterThan(-1);
    expect(tags).toBeLessThan(create);
    expect(entry).toContain('JULIUS_QUALIFYING_PAIR_NAMESPACES');
    expect(entry).toContain('spendCeilingUsdMicros: spendAuthorization.spendCeilingUsdMicros');
    expect(entry).not.toContain('contract.limits?.spendUsd ?? 5) * 1_000_000');
  });
});

const HEX = '0123456789abcdef01234567';
const TOKEN = 'ghs_test_not_a_real_token';

function github(handler: (url: string, init: RequestInit | undefined) => Response): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    return handler(href, init);
  }) as typeof fetch;
}

describe('the spent-tag listing is the durable record the cap reads', () => {
  it('an empty listing is a verified zero, and the token stays out of the url', async () => {
    const seen: string[] = [];
    const result = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      fetchImpl: github((url, init) => {
        seen.push(url);
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
        expect(url).not.toContain(TOKEN);
        return new Response('[]', { status: 200 });
      }),
    });
    expect(seen).toEqual(['https://api.github.com/repos/ohdieyuh-glitch/sunday-relay/git/matching-refs/tags/julius-run-spent-']);
    expect(result).toEqual({ readable: true, priorRuns: [], durableRecord: 'PRESENT' });
  });

  it('reads an annotated ceiling, skips this run\'s own tag, and fails closed on a bad response', async () => {
    const prior = 'abcdef0123456789abcdef01';
    const message = juliusSpentTagMessage({
      runId: `run:${prior}`, namespace: 'julius-live-mission-5', reservedUsdMicros: 30_000_000,
    });
    const result = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      excludeRunId: `run:${HEX}`,
      fetchImpl: github((url) => {
        if (url.endsWith('/julius-run-spent-')) {
          return new Response(JSON.stringify([
            { ref: `refs/tags/julius-run-spent-${HEX}`, object: { type: 'commit', sha: 'a'.repeat(40) } },
            { ref: `refs/tags/julius-run-spent-${prior}`, object: { type: 'tag', sha: 'b'.repeat(40) } },
          ]), { status: 200 });
        }
        expect(url).toBe(`https://api.github.com/repos/ohdieyuh-glitch/sunday-relay/git/tags/${'b'.repeat(40)}`);
        return new Response(JSON.stringify({ message }), { status: 200 });
      }),
    });
    expect(result).toEqual({
      readable: true,
      durableRecord: 'PRESENT',
      priorRuns: [{
        runId: `run:${prior}`, knownUsdMicros: 30_000_000, unknownCostComponents: 0,
        unverifiableApiSpend: false, spendVerified: true,
      }],
    });

    const broken = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      fetchImpl: github(() => new Response('no', { status: 500 })),
    });
    expect(broken).toEqual({ readable: false });
    const dropped = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      fetchImpl: github(() => { throw new Error('network down'); }),
    });
    expect(dropped).toEqual({ readable: false });
    const missing = await readJuliusSpentTagLedger({
      repository: '',
      token: '',
      namespace: 'julius-live-mission-5',
      fetchImpl: github(() => { throw new Error('must not be called'); }),
    });
    expect(missing).toEqual({ readable: false });
  });

  it('does not follow a next link off api.github.com', async () => {
    const seen: string[] = [];
    const result = await readJuliusSpentTagLedger({
      repository: 'ohdieyuh-glitch/sunday-relay',
      token: TOKEN,
      namespace: 'julius-live-mission-5',
      fetchImpl: github((url) => {
        seen.push(url);
        return new Response('[]', {
          status: 200,
          headers: { link: '<https://example.invalid/tags>; rel="next"' },
        });
      }),
    });
    expect(seen).toHaveLength(1);
    expect(result).toEqual({ readable: false });
  });
});

/* --------------------------------------------- count only real spend (J1) */

const REPO = 'ohdieyuh-glitch/sunday-relay';
const J1 = 'julius-inworld-data-1';
const API = `https://api.github.com/repos/${REPO}`;
const RESERVED = 30_000_000;

/** A deflated zip, the shape GitHub serves an artifact as. CRCs are not read. */
function zipOf(files: Readonly<Record<string, string>>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

interface RealRun {
  readonly wlj: string;
  readonly runId: number;
  readonly head: string;
  readonly run: Record<string, unknown>;
  readonly jobs: Record<string, unknown>;
  readonly artifacts: Record<string, unknown>;
  readonly zips: Readonly<Record<number, Uint8Array>>;
}

const STEP = (name: string, conclusion: string, number: number): Record<string, unknown> => ({ name, status: 'completed', conclusion, number });
function job(runId: number, head: string, name: string, conclusion: string, steps: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { name, status: 'completed', conclusion, run_id: runId, run_attempt: 1, head_sha: head, steps };
}
function artifact(id: number, name: string, runId: number, head: string): Record<string, unknown> {
  return { id, name, expired: false, size_in_bytes: 400, workflow_run: { id: runId, head_sha: head, head_branch: 'main', repository_id: 1316063101, head_repository_id: 1316063101 } };
}
function runBody(runId: number, head: string, conclusion: string): Record<string, unknown> {
  return { id: runId, path: '.github/workflows/julius-first-live-mission.yml', head_sha: head, run_attempt: 1, status: 'completed', conclusion };
}
const MISSION = 'Preflight, then the live mission';
const LIVE = 'LIVE: run the first real Julius mission';
const ATTEMPTED = 'Record that a paid mission was attempted (before any provider can be reached)';
const CHECKOUT = 'Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262';

/** The real headers of run 40278849833's bundle (worker-diagnostics.tsv's is cut to its first columns). */
const EMPTY_TSV: Readonly<Record<string, string>> = {
  'worker-diagnostics.tsv': 'run_id\tsequence\ttask_id\trole\tstage\ttransport\tprovider\tserved_model\n(0 rows)\n',
  'budget.tsv': 'run_id\tsequence\ttask_id\tevent_type\trole\tallocated_usd_micros\tallocation_basis\tshare_usd_micros\tremaining_usd_micros\tallocation_policy\tsettled_usd_micros\tcost_basis\testimated_usd_micros\tbilling_path\texecution_usd_micros\treason\tslot_refusal\treservation_id\toccurred_at\n(0 rows)\n',
  'cost-accounting.tsv': 'run_id\trole\tcomponents\tknown_usd_micros\testimated_usd_micros\tunknown_components\testimated_components\tunsettled_components\n(0 rows)\n',
  'tasks.tsv': 'task_id\ttask_type\trole\tstate\tordinal\tparent_task_id\trun_id\tlease_generation\n(0 rows)\n',
  'sessions.tsv': 'execution_id\tmission_id\tproject_id\tplayer_id\tagent_id\tstate\n(0 rows)\n',
};
function manifest(runId: number, head: string, attempt = 1): string {
  return [
    'manifest_version=1', 'source=github-actions', `commit=${head}`, 'tracked_changes=0', 'mode=paid',
    'mode_basis=dispatch_confirm_live', 'julius_run_id=none', `workflow_run_id=${String(runId)}`,
    `workflow_run_attempt=${String(attempt)}`, 'event=workflow_dispatch', 'ref=refs/heads/main', `github_sha=${head}`, '',
  ].join('\n');
}
const NOT_RUN_VERDICT = [
  'schema=julius-inworld-verdict.v1', 'verdict=NOT_RUN', 'reason=run_not_completed', 'run_id=none', 'task_id=none',
  'task_type=none', 'judged_trimmed_sha256=none', 'context_id=none', 'game_digest=none',
  'checker_sha256=1a98f1a4d739ebe2da254715d81f56cd5fa08d534a1fbf10ef6214e8b262207e', 'failed_sections=none', '',
].join('\n');

/** 40242149156: cancelled at checkout; LIVE listed as skipped. The real jobs response, trimmed to the fields read. */
function run40242149156(): RealRun {
  const runId = 40242149156; const head = '7f909165afb5dcd9f7a9ff2c84768c2be8d98996';
  return {
    wlj: 'wlj_23f50bac-67d8-497c-b31f-1db02311ae93', runId, head,
    run: runBody(runId, head, 'cancelled'),
    jobs: { total_count: 5, jobs: [
      job(runId, head, 'spend-tag', 'success', [STEP('Set up job', 'success', 1)]),
      job(runId, head, 'paid-slot', 'success', [STEP('Set up job', 'success', 1)]),
      job(runId, head, MISSION, 'cancelled', [
        STEP('Set up job', 'success', 1), STEP('Gate: a paid run is attempt 1 only', 'success', 2), STEP(CHECKOUT, 'cancelled', 3),
        STEP(ATTEMPTED, 'skipped', 28), STEP(LIVE, 'skipped', 32), STEP('Record that a paid mission completed', 'skipped', 36),
      ]),
      job(runId, head, 'J1: grade the final message with the pinned hidden checker', 'success', [STEP('Set up job', 'success', 1)]),
      job(runId, head, 'J1: delete the graded final message', 'cancelled', []),
    ] },
    artifacts: { total_count: 2, artifacts: [artifact(12617356530, 'julius-inworld-verdict', runId, head), artifact(12617336554, 'julius-live-evidence', runId, head)] },
    zips: {},
  };
}

/** 40258482240: paid-slot failed, so the mission job was skipped with no steps. No artifacts. */
function run40258482240(): RealRun {
  const runId = 40258482240; const head = '73a4aa3fe0c6a5d23fb6a10f5ac9121016443e28';
  return {
    wlj: 'wlj_1ed344d1-16f4-48fa-baa2-9f7cc8602e36', runId, head,
    run: runBody(runId, head, 'failure'),
    jobs: { total_count: 5, jobs: [
      job(runId, head, 'spend-tag', 'success', [STEP('Set up job', 'success', 1)]),
      job(runId, head, 'paid-slot', 'failure', [STEP('Set up job', 'success', 1)]),
      job(runId, head, MISSION, 'skipped', []),
      job(runId, head, 'J1: delete the graded final message', 'skipped', []),
      job(runId, head, 'J1: grade the final message with the pinned hidden checker', 'skipped', []),
    ] },
    artifacts: { total_count: 0, artifacts: [] },
    zips: {},
  };
}

/** 40278849833: LIVE ran and failed (spend_ledger_unreadable); evidence with 0 rows; verdict NOT_RUN. */
function run40278849833(evidence: Readonly<Record<string, string>> = {}, verdict: string = NOT_RUN_VERDICT): RealRun {
  const runId = 40278849833; const head = '840d47c153a4cf71f4a386e4990e0efe02c5d68e';
  return {
    wlj: 'wlj_309e375d-c2c6-4a63-8590-b417c07dd433', runId, head,
    run: runBody(runId, head, 'failure'),
    jobs: { total_count: 5, jobs: [
      job(runId, head, 'spend-tag', 'success', [STEP('Set up job', 'success', 1)]),
      job(runId, head, 'paid-slot', 'success', [STEP('Set up job', 'success', 1)]),
      job(runId, head, MISSION, 'failure', [
        STEP('Set up job', 'success', 1), STEP('Gate: a paid run is attempt 1 only', 'success', 2), STEP(CHECKOUT, 'success', 3),
        STEP(ATTEMPTED, 'success', 28), STEP(LIVE, 'failure', 32), STEP('Record that a paid mission completed', 'skipped', 36),
      ]),
      job(runId, head, 'J1: grade the final message with the pinned hidden checker', 'success', [STEP('Set up job', 'success', 1)]),
      job(runId, head, 'J1: delete the graded final message', 'skipped', []),
    ] },
    artifacts: { total_count: 3, artifacts: [
      artifact(12631931447, 'julius-live-evidence', runId, head),
      artifact(12631366777, 'julius-inworld-verdict', runId, head),
      artifact(12631067605, 'julius-inworld-data-1-attempted', runId, head),
    ] },
    zips: {
      12631931447: zipOf({ 'bundle-manifest.txt': manifest(runId, head), 'artifacts/BODIES.tsv': 'x\n', ...EMPTY_TSV, ...evidence }),
      12631366777: zipOf({ 'checker-verdict.txt': verdict }),
    },
  };
}

function spentTag(real: RealRun, overrides: { head?: string; attempt?: string; runId?: string } = {}): { ref: string; message: string } {
  const suffix = real.wlj.slice(4).replaceAll('-', '');
  return {
    ref: `refs/tags/julius-run-spent-${suffix}`,
    message: [
      'julius-run-spent.v1', `run=${real.wlj}`, `namespace=${J1}`, `reservedUsdMicros=${String(RESERVED)}`,
      `workflow_run_id=${overrides.runId ?? String(real.runId)}`, `workflow_run_attempt=${overrides.attempt ?? '1'}`,
      `head_sha=${overrides.head ?? real.head}`, '',
    ].join('\n'),
  };
}

interface GithubOptions {
  readonly tags?: readonly { ref: string; message: string }[];
  readonly fail?: (url: string) => boolean;
  readonly markers?: readonly RealRun[];
}

function githubFor(runs: readonly RealRun[], options: GithubOptions = {}): { fetchImpl: typeof fetch; seen: string[] } {
  const tags = options.tags ?? runs.map((run) => spentTag(run));
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    seen.push(url);
    if (options.fail?.(url) === true) return new Response('nope', { status: 500 });
    if (url === `${API}/git/matching-refs/tags/julius-run-spent-`) {
      return Response.json(tags.map((tag, index) => ({ ref: tag.ref, object: { type: 'tag', sha: String(index).padStart(40, 'c') } })));
    }
    const tagObject = /\/git\/tags\/c*([0-9]+)$/u.exec(url);
    if (tagObject !== null) return Response.json({ message: tags[Number(tagObject[1])]?.message });
    const markerList = /\/actions\/artifacts\?name=([a-z0-9-]+)-attempted&per_page=100$/u.exec(url);
    if (markerList !== null) {
      const list = (options.markers ?? []).flatMap((run) => (run.artifacts.artifacts as Record<string, unknown>[])
        .filter((entry) => entry.name === `${markerList[1] ?? ''}-attempted`));
      return Response.json({ total_count: list.length, artifacts: list });
    }
    const zip = /\/actions\/artifacts\/([0-9]+)\/zip$/u.exec(url);
    if (zip !== null) {
      // GitHub redirects to a signed URL; the token must not follow it.
      expect(init?.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { location: `https://blob.example.invalid/zip/${zip[1] ?? ''}` } });
    }
    const blob = /^https:\/\/blob\.example\.invalid\/zip\/([0-9]+)$/u.exec(url);
    if (blob !== null) {
      expect(new Headers(init?.headers).get('authorization'), 'the token never leaves api.github.com').toBeNull();
      for (const run of runs) {
        const bytes = run.zips[Number(blob[1])];
        if (bytes !== undefined) return new Response(new Uint8Array(bytes), { status: 200 });
      }
      return new Response('gone', { status: 404 });
    }
    for (const run of runs) {
      const base = `${API}/actions/runs/${String(run.runId)}`;
      if (url === base) return Response.json(run.run);
      if (url === `${base}/attempts/1/jobs?per_page=100`) return Response.json(run.jobs);
      if (url === `${base}/artifacts?per_page=100`) return Response.json(run.artifacts);
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

type Classified = Awaited<ReturnType<typeof readJuliusClassifiedSpentTags>>;

async function classify(runs: readonly RealRun[], options: GithubOptions = {}): Promise<Classified> {
  const { fetchImpl } = githubFor(runs, options);
  return readJuliusClassifiedSpentTags({ repository: REPO, token: TOKEN, namespace: J1, fetchImpl });
}

function withArtifacts(real: RealRun, map: (entries: Record<string, unknown>[]) => Record<string, unknown>[]): RealRun {
  const artifacts = map(real.artifacts.artifacts as Record<string, unknown>[]);
  return { ...real, artifacts: { total_count: artifacts.length, artifacts } };
}

describe('count only real spend: each prior run is NOT_EXECUTED, EXECUTED_CHARGES_KNOWN or UNKNOWN', () => {
  it('the three real J1 runs are all NOT_EXECUTED, so the next run is the initial run and authorized at $30', async () => {
    const result = await classify([run40242149156(), run40258482240(), run40278849833()]);
    expect(result.ledger).toEqual({ readable: true, priorRuns: [], durableRecord: 'PRESENT' });
    expect(result.audit.map((entry) => [entry.workflowRunId, entry.classification, entry.basis, entry.counted])).toEqual([
      ['40258482240', 'NOT_EXECUTED', 'no_provider_execution_live_never_ran', false],
      ['40242149156', 'NOT_EXECUTED', 'no_provider_execution_live_never_ran', false],
      ['40278849833', 'NOT_EXECUTED', 'no_provider_execution_zero_rows_not_run', false],
    ]);
    // NOT_EXECUTED is no provider execution, not a confirmed $0 charge.
    for (const entry of result.audit) {
      expect(juliusPriorRunLine(entry)).toContain('known_charges_usd_micros=UNKNOWN');
      expect(juliusPriorRunLine(entry)).toContain(`reserved_usd_micros=${String(RESERVED)}`);
    }
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: result.ledger }))
      .toEqual({ authorized: true, spendCeilingUsdMicros: RESERVED, maxRepairRounds: 3 });
  });

  it('the real line is allowlisted tokens', async () => {
    const result = await classify([run40278849833()]);
    expect(result.audit.map(juliusPriorRunLine)).toEqual([
      'prior_run run=wlj_309e375d-c2c6-4a63-8590-b417c07dd433 workflow_run_id=40278849833 attempt=1 classification=NOT_EXECUTED basis=no_provider_execution_zero_rows_not_run counted=false reserved_usd_micros=30000000 known_charges_usd_micros=UNKNOWN',
    ]);
  });

  it('proof (a) comes from the jobs API step state, and downloads no artifact', async () => {
    const { fetchImpl, seen } = githubFor([run40242149156(), run40258482240()]);
    const result = await readJuliusClassifiedSpentTags({ repository: REPO, token: TOKEN, namespace: J1, fetchImpl });
    expect(result.audit.map((entry) => entry.classification)).toEqual(['NOT_EXECUTED', 'NOT_EXECUTED']);
    expect(seen.some((url) => url.includes('/zip')), 'no artifact is downloaded once (a) holds').toBe(false);
  });

  it('a missing artifact alone never proves NOT_EXECUTED', async () => {
    const result = await classify([withArtifacts(run40278849833(), () => [])]);
    expect(result.audit[0]).toMatchObject({ classification: 'UNKNOWN', basis: 'evidence_unreadable', counted: true });
  });

  const unknownCases: readonly [string, () => Promise<Classified>, string][] = [
    ['wrong head in the tag', () => classify([run40278849833()], { tags: [spentTag(run40278849833(), { head: 'd'.repeat(40) })] }), 'run_mismatch'],
    ['wrong attempt in the tag', () => classify([run40242149156()], { tags: [spentTag(run40242149156(), { attempt: '2' })] }), 'run_attempt_mismatch'],
    ['wrong run id in the tag', () => classify([run40242149156()], { tags: [spentTag(run40242149156(), { runId: '40258482240' })] }), 'run_unreadable'],
    ['a run that moved to a later attempt', () => {
      const real = run40242149156();
      return classify([{ ...real, run: { ...real.run, run_attempt: 2 } }]);
    }, 'run_attempt_mismatch'],
    ['a jobs list from another attempt', () => {
      const real = run40242149156();
      const jobs = (real.jobs.jobs as Record<string, unknown>[]).map((entry) => ({ ...entry, run_attempt: 2 }));
      return classify([{ ...real, jobs: { total_count: 5, jobs } }]);
    }, 'jobs_mismatch'],
    ['a jobs list from another head', () => {
      const real = run40258482240();
      const jobs = (real.jobs.jobs as Record<string, unknown>[]).map((entry) => ({ ...entry, head_sha: 'a'.repeat(40) }));
      return classify([{ ...real, jobs: { total_count: 5, jobs } }]);
    }, 'jobs_mismatch'],
    ['a run not yet completed', () => {
      const real = run40258482240();
      return classify([{ ...real, run: { ...real.run, status: 'in_progress' } }]);
    }, 'run_not_completed'],
    ['a run of another workflow', () => {
      const real = run40258482240();
      return classify([{ ...real, run: { ...real.run, path: '.github/workflows/ci.yml' } }]);
    }, 'run_mismatch'],
    ['a manifest naming another run', () => classify([run40278849833({ 'bundle-manifest.txt': manifest(40278849834, '840d47c153a4cf71f4a386e4990e0efe02c5d68e') })]), 'evidence_mismatch'],
    ['a manifest naming another attempt', () => classify([run40278849833({ 'bundle-manifest.txt': manifest(40278849833, '840d47c153a4cf71f4a386e4990e0efe02c5d68e', 2) })]), 'evidence_mismatch'],
    ['a manifest naming another head', () => classify([run40278849833({ 'bundle-manifest.txt': manifest(40278849833, 'b'.repeat(40)) })]), 'evidence_mismatch'],
    ['an evidence artifact on another head', () => classify([withArtifacts(run40278849833(), (entries) => entries.map((entry) => (entry.name === 'julius-live-evidence'
      ? { ...entry, workflow_run: { id: 40278849833, head_sha: 'e'.repeat(40) } } : entry)))]), 'evidence_unreadable'],
    ['two evidence artifacts', () => classify([withArtifacts(run40278849833(), (entries) => [...entries, artifact(1, 'julius-live-evidence', 40278849833, '840d47c153a4cf71f4a386e4990e0efe02c5d68e')])]), 'evidence_unreadable'],
    ['an expired evidence artifact', () => classify([withArtifacts(run40278849833(), (entries) => entries.map((entry) => (entry.name === 'julius-live-evidence' ? { ...entry, expired: true } : entry)))]), 'evidence_unreadable'],
    ['a malformed TSV (no footer)', () => classify([run40278849833({ 'tasks.tsv': 'task_id\ttask_type\n' })]), 'evidence_malformed'],
    ['an unavailable TSV', () => classify([run40278849833({ 'budget.tsv': 'unavailable\n' })]), 'evidence_malformed'],
    ['a footer that disagrees with the rows', () => classify([run40278849833({ 'sessions.tsv': 'execution_id\n(1 row)\n' })]), 'evidence_malformed'],
    ['a missing TSV', () => {
      const real = run40278849833();
      return classify([{ ...real, zips: { ...real.zips, 12631931447: zipOf({ 'bundle-manifest.txt': manifest(real.runId, real.head), 'tasks.tsv': EMPTY_TSV['tasks.tsv'] ?? '' }) } }]);
    }, 'evidence_malformed'],
    ['a FAIL verdict', () => classify([run40278849833({}, NOT_RUN_VERDICT.replace('verdict=NOT_RUN', 'verdict=FAIL'))]), 'verdict_not_not_run'],
    ['a PASS verdict', () => classify([run40278849833({}, NOT_RUN_VERDICT.replace('verdict=NOT_RUN', 'verdict=PASS'))]), 'verdict_not_not_run'],
    ['a verdict with no verdict line', () => classify([run40278849833({}, NOT_RUN_VERDICT.replace('verdict=NOT_RUN\n', ''))]), 'verdict_not_not_run'],
    ['a verdict with a repeated key', () => classify([run40278849833({}, `${NOT_RUN_VERDICT}verdict=NOT_RUN\n`)]), 'verdict_unreadable'],
    ['a verdict of another schema', () => classify([run40278849833({}, NOT_RUN_VERDICT.replace('julius-inworld-verdict.v1', 'other.v1'))]), 'verdict_unreadable'],
    ['a missing verdict artifact', () => classify([withArtifacts(run40278849833(), (entries) => entries.filter((entry) => entry.name !== 'julius-inworld-verdict'))]), 'verdict_unreadable'],
    ['the run API failing', () => classify([run40258482240()], { fail: (url) => url.endsWith('/actions/runs/40258482240') }), 'run_unreadable'],
    ['the jobs API failing', () => classify([run40258482240()], { fail: (url) => url.includes('/jobs') }), 'jobs_unreadable'],
    ['the artifacts API failing', () => classify([run40278849833()], { fail: (url) => url.endsWith('/artifacts?per_page=100') }), 'evidence_unreadable'],
    ['the artifact download failing', () => classify([run40278849833()], { fail: (url) => url.includes('blob.example.invalid') }), 'evidence_unreadable'],
    ['a truncated jobs list', () => {
      const real = run40258482240();
      return classify([{ ...real, jobs: { ...real.jobs, total_count: 6 } }]);
    }, 'jobs_unreadable'],
    ['two LIVE steps listed', () => {
      const real = run40278849833();
      const jobs = (real.jobs.jobs as Record<string, unknown>[]).map((entry) => (entry.name === MISSION
        ? { ...entry, steps: [STEP(LIVE, 'skipped', 32), STEP(LIVE, 'skipped', 33)] } : entry));
      return classify([{ ...real, jobs: { total_count: 5, jobs } }]);
    }, 'jobs_unreadable'],
  ];

  for (const [name, run, basis] of unknownCases) {
    it(`UNKNOWN, counted at the full reservation: ${name}`, async () => {
      const result = await run();
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0]).toMatchObject({ classification: 'UNKNOWN', basis, counted: true, reservedUsdMicros: RESERVED, knownChargesUsdMicros: null });
      expect(result.ledger.readable).toBe(true);
      if (!result.ledger.readable) return;
      expect(result.ledger.priorRuns).toEqual([{
        runId: result.audit[0]?.runId, knownUsdMicros: RESERVED, unknownCostComponents: 0, unverifiableApiSpend: false, spendVerified: true,
      }]);
    });
  }

  it('an UNKNOWN prior prints UNKNOWN charges, never 0', async () => {
    const result = await classify([run40258482240()], { fail: (url) => url.includes('/jobs') });
    const line = juliusPriorRunLine(result.audit[0] as JuliusPriorRunAudit);
    expect(line).toContain('classification=UNKNOWN');
    expect(line).toContain('counted=true');
    expect(line).toContain('known_charges_usd_micros=UNKNOWN');
    expect(line).not.toMatch(/=0(\s|$)/u);
  });

  it('a prior run with worker-diagnostics rows is counted, and only settled charges are EXECUTED_CHARGES_KNOWN', async () => {
    const wlj = 'wlj_309e375d-c2c6-4a63-8590-b417c07dd433';
    const header = 'run_id\trole\tcomponents\tknown_usd_micros\testimated_usd_micros\tunknown_components\testimated_components\tunsettled_components';
    const diagnostics = `run_id\tsequence\ttask_id\trole\n${wlj}\t4\tplan-1\tPROMPT_ARCHITECT\n(1 row)\n`;
    const unsettled = await classify([run40278849833({ 'worker-diagnostics.tsv': diagnostics })]);
    expect(unsettled.audit[0]).toMatchObject({ classification: 'UNKNOWN', basis: 'executed_charges_unreadable', counted: true, knownChargesUsdMicros: null });

    const known = await classify([run40278849833({
      'worker-diagnostics.tsv': diagnostics,
      'cost-accounting.tsv': `${header}\n${wlj}\tPROMPT_ARCHITECT\t1\t1250000\t0\t0\t0\t0\n(1 row)\n`,
    })]);
    expect(known.audit[0]).toMatchObject({ classification: 'EXECUTED_CHARGES_KNOWN', basis: 'executed_charges_settled', counted: true, knownChargesUsdMicros: 1_250_000 });
    // The reservation is the floor: a run that executed counts at least its $30.
    expect(known.ledger.readable && known.ledger.priorRuns[0]?.knownUsdMicros).toBe(RESERVED);
    expect(juliusPriorRunLine(known.audit[0] as JuliusPriorRunAudit)).toContain('known_charges_usd_micros=1250000');

    const above = await classify([run40278849833({ 'cost-accounting.tsv': `${header}\n${wlj}\tCODING_AGENT\t1\t31000000\t0\t0\t0\t0\n(1 row)\n` })]);
    expect(above.ledger.readable && above.ledger.priorRuns[0]?.knownUsdMicros, 'known charges above the reservation count as they are').toBe(31_000_000);

    const estimated = await classify([run40278849833({ 'cost-accounting.tsv': `${header}\n${wlj}\tCODING_AGENT\t2\t1\t5\t0\t1\t0\n(1 row)\n` })]);
    expect(estimated.audit[0]).toMatchObject({ classification: 'UNKNOWN', counted: true });

    const otherRun = await classify([run40278849833({ 'cost-accounting.tsv': `${header}\nwlj_other\tCODING_AGENT\t1\t1\t0\t0\t0\t0\n(1 row)\n` })]);
    expect(otherRun.audit[0]).toMatchObject({ classification: 'UNKNOWN', counted: true });
  });

  it('counted priors still refuse a third run; zero-proved ones do not', async () => {
    const mixed = await classify([run40242149156(), run40258482240(), run40278849833({ 'tasks.tsv': 'task_id\nplan-1\n(1 row)\n' })]);
    expect(mixed.ledger.readable && mixed.ledger.priorRuns.length).toBe(1);
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: mixed.ledger })).toMatchObject({ authorized: true });
    const unknownBoth = await classify([run40242149156(), run40258482240()], { fail: (url) => url.includes('/jobs') });
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: unknownBoth.ledger }))
      .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_third_run_refused' });
  });

  it('a proof is used only for the binding it was made for', () => {
    const real = run40242149156();
    const proof = classifyJuliusPriorRun({
      binding: { workflowRunId: String(real.runId), workflowRunAttempt: '1', headSha: real.head },
      run: real.run, jobs: real.jobs, artifacts: real.artifacts, liveEvidence: null, verdict: null,
    }, real.wlj);
    expect(proof.classification).toBe('NOT_EXECUTED');
    const result = classifyJuliusSpentTags({ namespace: J1, tags: [spentTag(real, { head: 'f'.repeat(40) })], proofs: new Map([[real.wlj, proof]]) });
    expect(result.audit[0]).toMatchObject({ classification: 'UNKNOWN', basis: 'proof_binding_mismatch', counted: true });
    const bound = classifyJuliusSpentTags({ namespace: J1, tags: [spentTag(real)], proofs: new Map([[real.wlj, proof]]) });
    expect(bound.audit[0]).toMatchObject({ classification: 'NOT_EXECUTED', counted: false });
  });

  it('a zero-proved prior run\'s own wlj still cannot be dispatched again: its spent tag refuses', async () => {
    const real = run40278849833();
    const result = await classify([real]);
    expect(result.audit[0]?.classification).toBe('NOT_EXECUTED');
    // The admission spend set is every spent tag, whatever its classification.
    const spent = new Set([spentTag(real).ref.slice('refs/tags/julius-run-spent-'.length)]);
    expect(claimJuliusAdmissionSpend(spent, real.wlj).decision).toEqual({ ok: false, reasonCode: 'admission_run_already_spent' });
  });

  it('a whole listing that fails is unreadable, never zero', async () => {
    const result = await classify([run40242149156()], { fail: (url) => url.includes('matching-refs') });
    expect(result).toEqual({ ledger: { readable: false }, audit: [] });
  });
});

describe('the attempted-marker gate uses the same proofs', () => {
  it('the real 40278849833 marker is NOT_EXECUTED and does not count', async () => {
    const real = run40278849833();
    const markers = await readJuliusAttemptMarkers({ repository: REPO, token: TOKEN, namespace: J1, fetchImpl: githubFor([real], { markers: [real] }).fetchImpl });
    expect(markers.readable).toBe(true);
    if (!markers.readable) return;
    expect(markers.proofs.map(juliusAttemptMarkerLine)).toEqual([
      'attempt_marker workflow_run_id=40278849833 attempt=1 classification=NOT_EXECUTED basis=no_provider_execution_zero_rows_not_run counted=false',
    ]);
  });

  it('a marker whose run executed, or cannot be read, counts', async () => {
    const executed = run40278849833({ 'budget.tsv': 'run_id\nx\n(1 row)\n' });
    const one = await readJuliusAttemptMarkers({ repository: REPO, token: TOKEN, namespace: J1, fetchImpl: githubFor([executed], { markers: [executed] }).fetchImpl });
    expect(one.readable && one.proofs[0]?.classification).toBe('UNKNOWN');
    const real = run40278849833();
    const down = await readJuliusAttemptMarkers({
      repository: REPO, token: TOKEN, namespace: J1,
      fetchImpl: githubFor([real], { markers: [real], fail: (url) => url.includes('/actions/runs/') }).fetchImpl,
    });
    expect(down.readable && down.proofs[0]?.classification).toBe('UNKNOWN');
  });

  it('a marker listing that fails is unreadable', async () => {
    const real = run40278849833();
    const markers = await readJuliusAttemptMarkers({
      repository: REPO, token: TOKEN, namespace: J1,
      fetchImpl: githubFor([real], { markers: [real], fail: (url) => url.includes('?name=') }).fetchImpl,
    });
    expect(markers).toEqual({ readable: false });
  });
});

describe('the zip reader is strict', () => {
  it('reads the named files and refuses bytes that are not a zip', () => {
    const files = readZipTextFiles(zipOf({ 'a.tsv': 'x\n(0 rows)\n', 'b.txt': 'y' }), ['a.tsv']);
    expect(files === null ? null : [...files.entries()]).toEqual([['a.tsv', 'x\n(0 rows)\n']]);
    expect(readZipTextFiles(new Uint8Array([1, 2, 3]), ['a.tsv'])).toBeNull();
  });
});

describe('the two pre-marker commands the paid workflow runs', () => {
  const contract = readFileSync('.github/julius-missions/julius-inworld-data-1/contract.json', 'utf8');
  const fresh = 'wlj_0b6f5d3e-2f4a-4c1d-9e8f-7a6b5c4d3e2f';
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: TOKEN, JULIUS_RUN_ID: fresh, JULIUS_SERVER_RUN_ID: fresh };

  async function command(
    run: typeof authorizeSpendCommand,
    runs: readonly RealRun[],
    options: GithubOptions = {},
  ): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    const code = await run({
      contractPath: 'contract.json', env, out: (line) => lines.push(line), readFile: () => contract,
      fetchImpl: githubFor(runs, options).fetchImpl,
    });
    return { code, lines };
  }

  it('authorize-spend authorizes the initial J1 run over the three real NOT_EXECUTED runs', async () => {
    const { code, lines } = await command(authorizeSpendCommand, [run40242149156(), run40258482240(), run40278849833()]);
    expect(code).toBe(0);
    expect(lines.filter((line) => line.startsWith('prior_run ')).map((line) => /classification=(\S+)/u.exec(line)?.[1])).toEqual(['NOT_EXECUTED', 'NOT_EXECUTED', 'NOT_EXECUTED']);
    expect(lines).toContain('prior_runs ledger=READABLE counted=0 of=3');
    expect(lines.at(-1)).toBe('spend_pre_marker=authorized namespace=julius-inworld-data-1 spend_ceiling_usd_micros=30000000 max_repair_rounds=3');
    expect(lines.join('\n'), 'the token is never printed').not.toContain(TOKEN);
  });

  it('authorize-spend refuses, exit 1, when two priors are UNKNOWN, and when the ledger is unreadable', async () => {
    const unknown = await command(authorizeSpendCommand, [run40242149156(), run40258482240()], { fail: (url) => url.includes('/jobs') });
    expect(unknown.code).toBe(1);
    expect(unknown.lines.at(-1)).toContain('qualifying_pair_third_run_refused');
    const unreadable = await command(authorizeSpendCommand, [run40242149156()], { fail: (url) => url.includes('matching-refs') });
    expect(unreadable.code).toBe(1);
    expect(unreadable.lines).toContain('prior_runs ledger=UNREADABLE counted=UNKNOWN');
    expect(unreadable.lines.at(-1)).toContain('spend_ledger_unreadable');
  });

  it('attempt-markers does not count a NOT_EXECUTED marker, and counts every other', async () => {
    const real = run40278849833();
    const zero = await command(attemptMarkersCommand, [real], { markers: [real] });
    expect(zero.code).toBe(0);
    expect(zero.lines.at(-1)).toBe('attempt_markers_counted=0');
    const executed = run40278849833({ 'sessions.tsv': 'execution_id\nexecution:x\n(1 row)\n' });
    const one = await command(attemptMarkersCommand, [executed], { markers: [executed] });
    expect(one.lines.at(-1)).toBe('attempt_markers_counted=1');
    const down = await command(attemptMarkersCommand, [real], { markers: [real], fail: (url) => url.includes('?name=') });
    expect(down).toEqual({ code: 1, lines: ['attempt_markers_counted=UNKNOWN'] });
  });
});

describe('REVIEW pins: the classified listing never drops or zeroes a run it cannot prove', () => {
  const real = run40242149156();
  const realProof = () => classifyJuliusPriorRun({
    binding: { workflowRunId: String(real.runId), workflowRunAttempt: '1', headSha: real.head },
    run: real.run, jobs: real.jobs, artifacts: real.artifacts, liveEvidence: null, verdict: null,
  }, real.wlj);

  it('(a) an unreadable base listing stays unreadable, never a readable empty ledger', () => {
    const result = classifyJuliusSpentTags({ namespace: J1, tags: [{ ref: 'refs/tags/julius-run-spent-not-hex', message: null }] });
    expect(result).toEqual({ ledger: { readable: false }, audit: [] });
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: result.ledger }))
      .toMatchObject({ authorized: false, reasonCode: 'spend_ledger_unreadable' });
  });

  it('(b) an unverified tag is kept as UNKNOWN and counted, never dropped', () => {
    // A lightweight (commit) tag carries no message, so the record cannot verify it.
    const tag = { ref: spentTag(real).ref, message: null };
    const result = classifyJuliusSpentTags({ namespace: J1, tags: [tag], proofs: new Map([[real.wlj, realProof()]]) });
    expect(result.audit).toEqual([expect.objectContaining({ runId: real.wlj, classification: 'UNKNOWN', basis: 'tag_unverified', counted: true })]);
    expect(result.ledger.readable && result.ledger.priorRuns).toEqual([expect.objectContaining({ runId: real.wlj, spendVerified: false })]);
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: result.ledger }))
      .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_unverified' });
  });

  it('(c) a verified tag whose audit lines cannot be re-read stays counted at its full reservation', () => {
    // The four-line reservation alone: verified spend, but no binding to read a proof against.
    const fourLines = spentTag(real).message.split('\n').slice(0, 4).join('\n') + '\n';
    const result = classifyJuliusSpentTags({ namespace: J1, tags: [{ ref: spentTag(real).ref, message: fourLines }], proofs: new Map([[real.wlj, realProof()]]) });
    expect(result.audit).toEqual([expect.objectContaining({ classification: 'UNKNOWN', basis: 'tag_unbound', counted: true, reservedUsdMicros: RESERVED })]);
    expect(result.ledger.readable && result.ledger.priorRuns).toEqual([expect.objectContaining({ runId: real.wlj, knownUsdMicros: RESERVED, spendVerified: true })]);
  });

  it('(d) a proof whose run id OR attempt differs, on the matching head, does not remove the tag', () => {
    const proof = realProof();
    expect(proof.classification).toBe('NOT_EXECUTED');
    for (const binding of [
      { ...proof.binding, workflowRunId: '40242149157' },
      { ...proof.binding, workflowRunAttempt: '2' },
    ]) {
      const result = classifyJuliusSpentTags({ namespace: J1, tags: [spentTag(real)], proofs: new Map([[real.wlj, { ...proof, binding }]]) });
      expect(result.audit[0], JSON.stringify(binding)).toMatchObject({ classification: 'UNKNOWN', basis: 'proof_binding_mismatch', counted: true });
      expect(result.ledger.readable && result.ledger.priorRuns.length, JSON.stringify(binding)).toBe(1);
    }
  });

  it('(e) a LIVE step that concluded cancelled ran, so proof (a) does not hold', () => {
    const base = run40258482240();
    const jobs = (base.jobs.jobs as Record<string, unknown>[]).map((entry) => (entry.name === MISSION
      ? { ...entry, conclusion: 'cancelled', steps: [STEP(ATTEMPTED, 'success', 28), STEP(LIVE, 'cancelled', 32)] } : entry));
    const proof = classifyJuliusPriorRun({
      binding: { workflowRunId: String(base.runId), workflowRunAttempt: '1', headSha: base.head },
      run: base.run, jobs: { total_count: jobs.length, jobs }, artifacts: base.artifacts, liveEvidence: null, verdict: null,
    }, base.wlj);
    expect(proof.basis).not.toBe('no_provider_execution_live_never_ran');
    expect(proof.classification).toBe('UNKNOWN');
  });
});
