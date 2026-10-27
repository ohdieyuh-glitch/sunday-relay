/**
 * The Wonderland Start's `gh api -X GET` prior-attempt reader, against the real
 * J1 run fixtures. Moved verbatim from julius-prior-spend.test.ts so that file
 * stays byte-identical to b2764b76; the fixtures below are copied from it
 * unchanged.
 */

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { countUnexpiredArtifacts, createGhPriorAttemptReader, ghApiFetch, ghApiGetArgs, type GhBytesRunner } from '../wonderland-prior-attempts';

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
    // X′ §2: the attempted markers are also read as record tags; this fixture has none.
    if (url === `${API}/git/matching-refs/tags/julius-run-record-`) return Response.json([]);
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

describe('the Wonderland Start reads the same markers through `gh api -X GET`', () => {
  /** `gh` as the bridge runs it: GET only, GitHub's redirect followed by `gh` itself, raw bytes out. */
  function ghFor(runs: readonly RealRun[], options: GithubOptions = {}, mangle = false): { run: GhBytesRunner; argv: string[][] } {
    const { fetchImpl } = githubFor(runs, options);
    const argv: string[][] = [];
    return {
      argv,
      run: async (args) => {
        argv.push([...args]);
        if (args[0] !== 'api' || args[1] !== '-X' || args[2] !== 'GET' || args.length !== 4) return { code: 2, stdout: new Uint8Array() };
        let response = await fetchImpl(`https://api.github.com/${args[3] ?? ''}`, { redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) response = await fetchImpl(response.headers.get('location') ?? '', {});
        if (!response.ok) return { code: 1, stdout: new Uint8Array() };
        const bytes = new Uint8Array(await response.arrayBuffer());
        // A text-only shim: what a utf8-decoded child would hand back.
        return { code: 0, stdout: mangle ? new TextEncoder().encode(new TextDecoder().decode(bytes)) : bytes };
      },
    };
  }

  it('40278849833 reads NOT_EXECUTED from its real zips through the bytes, so the count is 0; an executed marker counts 1', async () => {
    const real = run40278849833();
    const zero = ghFor([real], { markers: [real] });
    expect(await createGhPriorAttemptReader(zero.run).read({ repo: REPO, namespace: J1 })).toEqual({ readable: true, counted: 0 });
    expect(zero.argv.some((args) => (args[3] ?? '').endsWith('/zip')), 'the zero-row proof needed the artifact bytes').toBe(true);
    expect(zero.argv.every((args) => args.slice(0, 3).join(' ') === 'api -X GET')).toBe(true);
    const executed = run40278849833({ 'sessions.tsv': 'execution_id\nexecution:x\n(1 row)\n' });
    const one = ghFor([executed], { markers: [executed] });
    expect(await createGhPriorAttemptReader(one.run).read({ repo: REPO, namespace: J1 })).toEqual({ readable: true, counted: 1 });
  });

  it('a text-only shim cannot read the zip, so the same run is UNKNOWN and counted: the bytes path is load-bearing', async () => {
    const real = run40278849833();
    const mangled = ghFor([real], { markers: [real] }, true);
    expect(await createGhPriorAttemptReader(mangled.run).read({ repo: REPO, namespace: J1 })).toEqual({ readable: true, counted: 1 });
  });

  it('a listing gh cannot read is UNKNOWN, never zero; a non-GET or a foreign URL is never run', async () => {
    const real = run40278849833();
    const down = ghFor([real], { markers: [real], fail: (url) => url.includes('?name=') });
    expect(await createGhPriorAttemptReader(down.run).read({ repo: REPO, namespace: J1 })).toEqual({ readable: false });
    const argv: string[][] = [];
    const fetchImpl = ghApiFetch(async (args) => { argv.push([...args]); return { code: 0, stdout: new Uint8Array() }; });
    expect((await fetchImpl('https://api.github.com/repos/x/y', { method: 'POST' })).ok).toBe(false);
    expect((await fetchImpl('https://example.com/repos/x/y')).ok).toBe(false);
    expect((await fetchImpl('https://api.github.com/../x')).ok).toBe(false);
    expect((await fetchImpl('https://api.github.com/-X')).ok).toBe(false);
    expect(argv).toEqual([]);
    expect(ghApiGetArgs('https://api.github.com/repos/o/r/actions/artifacts?name=a-attempted&per_page=100'))
      .toEqual(['api', '-X', 'GET', 'repos/o/r/actions/artifacts?name=a-attempted&per_page=100']);
  });
});

describe('the Wonderland Start reads the step-9 completed markers the way the workflow jq counts them', () => {
  const runner = (code: number, body: unknown): { run: GhBytesRunner; argv: string[][] } => {
    const argv: string[][] = [];
    return {
      argv,
      run: async (args) => {
        argv.push([...args]);
        return { code, stdout: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)) };
      },
    };
  };

  it('counts unexpired entries only, from one GET of the named listing', async () => {
    const ok = runner(0, { total_count: 5, artifacts: [{ expired: false }, { expired: true }, { expired: false }, null, {}, { expired: 'false' }] });
    expect(await createGhPriorAttemptReader(ok.run).readCompleted({ repo: REPO, namespace: J1 })).toEqual({ readable: true, counted: 2 });
    expect(ok.argv).toEqual([['api', '-X', 'GET', `repos/${REPO}/actions/artifacts?name=${J1}-completed&per_page=100`]]);
    expect(await createGhPriorAttemptReader(runner(0, { artifacts: [] }).run).readCompleted({ repo: REPO, namespace: J1 })).toEqual({ readable: true, counted: 0 });
  });

  it('anything the jq would fail on is UNKNOWN, never zero', async () => {
    for (const [code, body] of [[1, { artifacts: [] }], [0, 'not json'], [0, []], [0, {}], [0, { artifacts: null }], [0, { artifacts: ['x'] }], [0, { artifacts: [[]] }], [0, { artifacts: [3] }]] as const) {
      expect(await createGhPriorAttemptReader(runner(code, body).run).readCompleted({ repo: REPO, namespace: J1 }), JSON.stringify(body)).toEqual({ readable: false });
    }
    const never = runner(0, { artifacts: [] });
    expect(await createGhPriorAttemptReader(never.run).readCompleted({ repo: REPO, namespace: 'X' })).toEqual({ readable: false });
    expect(await createGhPriorAttemptReader(never.run).readCompleted({ repo: 'not a repo', namespace: J1 })).toEqual({ readable: false });
    expect(never.argv).toEqual([]);
    expect(countUnexpiredArtifacts({ artifacts: [{ expired: false }, null] })).toBe(1);
  });
});
