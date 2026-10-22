import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMemoryDispatchLedger } from './julius-dispatch';
import { createJ1LiveDispatchWithPins } from './julius-dispatch-wiring-core';
import { createCoderRoleProvider, createFrozenRunLookup } from './julius-dispatch-adapters';
import { buildJ1CoderProviderFor, J1_CODER_AUTH_MODE, J1_SHELL_PORT_MISSING, realJ1WiringDeps } from './julius-dispatch-wiring-real';
import { createJ1LiveDispatchFromEnv, J1_PINNED_CHECKER_SHA256, J1_PINNED_CONTRACT_SHA256 } from './julius-dispatch-wiring';
import {
  ARTIFACT, createJ1LiveForTest, dispatchInput, echoed, fakeCoder, fakeShell, FILES, goodEnv, KEY, makeDeps, PIN, sha,
} from './julius-dispatch-wiring-testkit';


describe('J1 live wiring (fakes only)', () => {
  it('the frozen pin constants are the contract file sha256 in this tree and the reviewer-frozen checker sha256', () => {
    expect(J1_PINNED_CHECKER_SHA256).toBe('1d1dc64ff9cf8f1f4133bbe22a65c483a9ad343a3ef4c2ee898709549b46f5dd');
    expect(sha(readFileSync(join(__dirname, 'julius-inworld-mission', 'julius-inworld-data-1', 'contract.json')))).toBe(J1_PINNED_CONTRACT_SHA256);
  });

  it('DEFAULT OFF: without JULIUS_J1_ENABLED=1 it is the uncomposed refuse-only controller and touches no dependency', async () => {
    const { deps, probe } = makeDeps({ readFileSync: () => { throw new Error('must not read'); }, openLedger: () => { throw new Error('must not open'); } });
    const r = createJ1LiveForTest(goodEnv({ JULIUS_J1_ENABLED: undefined }), deps);
    expect(r).toMatchObject({ live: false, reason: 'j1_disabled' });
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_disabled' });
    expect(probe.ledgers).toHaveLength(0);
    for (const off of ['0', 'true', '', ' 1']) expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_ENABLED: off }), deps).live).toBe(false);
  });

  it('every missing configuration value refuses (reason code only), and no value or key reaches the log', () => {
    const names = Object.keys(goodEnv()).filter((n) => n.startsWith('JULIUS_J1_') && n !== 'JULIUS_J1_ENABLED');
    expect(names.length).toBeGreaterThan(25);
    for (const name of names) {
      const { deps, probe } = makeDeps();
      const r = createJ1LiveForTest(goodEnv({ [name]: undefined }), deps);
      expect(r.live, name).toBe(false);
      expect(r.reason, name).toBe(`config_missing_${name.toLowerCase()}`);
      expect(probe.ledgers, name).toHaveLength(0);
      expect(probe.logs.join('\n')).not.toMatch(/canary_|ZZ9/);
    }
  });

  it('a missing dependency refuses (coder provider, shell)', () => {
    expect(createJ1LiveForTest(goodEnv(), makeDeps({ coderProviderFor: null }).deps)).toMatchObject({ live: false, reason: 'dep_coder_provider_absent' });
    expect(createJ1LiveForTest(goodEnv(), makeDeps({ shell: null }).deps)).toMatchObject({ live: false, reason: 'dep_shell_absent' });
  });

  it('a mismatched checker sha refuses: the env value, or the file on disk', async () => {
    const wrongEnv = createJ1LiveForTest(goodEnv({ JULIUS_J1_CHECKER_SHA256: 'f'.repeat(64) }), makeDeps().deps);
    expect(wrongEnv).toMatchObject({ live: false, reason: 'pin_checker_sha256_not_the_frozen_value' });
    const { deps, probe } = makeDeps({}, { ...FILES, '/pins/checker.mjs': 'tampered checker' });
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r).toMatchObject({ live: false, reason: 'pin_checker_file_mismatch' });
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 503 });
    expect(probe.ledgers).toHaveLength(0);
    expect(probe.spawned).toHaveLength(0);
  });

  it('the default pins are the real frozen ones: fake bytes cannot satisfy them', () => {
    const { deps } = makeDeps();
    expect(createJ1LiveDispatchFromEnv(goodEnv(), deps)).toMatchObject({ live: false, reason: 'pin_contract_sha256_not_the_frozen_value' });
  });

  it('other pin mismatches refuse: contract file bytes, seed ledger, seed posts, malformed sha, unreadable file', () => {
    expect(createJ1LiveForTest(goodEnv(), makeDeps({}, { ...FILES, '/pins/contract.json': 'other' }).deps)).toMatchObject({ live: false, reason: 'pin_contract_sha256_mismatch' });
    expect(createJ1LiveForTest(goodEnv(), makeDeps({}, { ...FILES, '/pins/ledger.csv': 'other' }).deps)).toMatchObject({ live: false, reason: 'pin_seed_ledger_file_mismatch' });
    expect(createJ1LiveForTest(goodEnv(), makeDeps({}, { ...FILES, '/pins/posts.json': 'other' }).deps)).toMatchObject({ live: false, reason: 'pin_seed_posts_file_mismatch' });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_SEED_POSTS_SHA256: 'xyz' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_invalid_julius_j1_seed_posts_sha256' });
    const noChecker = { ...FILES }; delete noChecker['/pins/checker.mjs'];
    expect(createJ1LiveForTest(goodEnv(), makeDeps({}, noChecker).deps)).toMatchObject({ live: false, reason: 'pin_checker_unreadable' });
  });

  it('a shared vendor, a same-author checker, a bad budget or an unopenable ledger all refuse', () => {
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_REVIEWER_MODEL: 'gpt-grok-like' }), makeDeps().deps).live).toBe(false);
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_CHECKER_AUTHOR: 'JUDEV' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'frozen_mission_record_invalid' });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_BUDGET_CAP_USD: '0' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_invalid_julius_j1_budget_cap_usd' });
    expect(createJ1LiveForTest(goodEnv(), makeDeps({ openLedger: () => { throw new Error(`disk ${KEY.xai}`); } }).deps)).toMatchObject({ live: false, reason: 'ledger_open_failed' });
  });

  it('a good env yields a LIVE controller composed with three different vendors, ledger opened once at the configured path', () => {
    const paths: string[] = [];
    const { deps, probe } = makeDeps({ openLedger: (f) => { paths.push(f); return createMemoryDispatchLedger(); } });
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r).toMatchObject({ live: true, reason: null });
    expect(paths).toEqual(['/ledger/j1.jsonl']);
    expect(r.controller.killSwitchOn()).toBe(true);
    expect(probe.fetched).toHaveLength(0);
    expect(probe.spawned).toHaveLength(0);
  });

  it('the controller re-reads the kill switch from the env accessor', () => {
    const env = goodEnv();
    const r = createJ1LiveForTest(() => env, makeDeps().deps);
    expect(r.live).toBe(true);
    expect(r.controller.killSwitchOn()).toBe(true);
    env.JULIUS_J1_ENABLED = '0';
    expect(r.controller.killSwitchOn()).toBe(false);
  });

  it('END TO END (all fakes): dispatch runs architect, coder, reviewer, the frozen checker, ends COMPLETED and writes ledger rows with no key', async () => {
    const { deps, probe } = makeDeps();
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(await r.controller.dispatch(await echoed(r.controller))).toMatchObject({ ok: true, mode: 'live' });
    await r.controller.whenIdle();
    const rows = await probe.ledgers[0]!.rows();
    expect(rows.find((row) => row.role === 'final')).toMatchObject({ state: 'COMPLETED' });
    expect(rows.map((row) => row.phase)).toContain('run_start');
    expect(JSON.stringify(rows)).not.toContain(KEY.openai);
    expect(JSON.stringify(rows)).not.toContain(KEY.xai);
    expect(probe.fetched).toHaveLength(1);
    expect(probe.fetched[0]!.auth).toBe(`Bearer ${KEY.xai}`);
    expect(probe.spawned).toHaveLength(1);
    expect(probe.spawned[0]!.args).toContain('--expect-self-sha256');
    expect(probe.artifacts.get(probe.spawned[0]!.args[1]!)).toBe(ARTIFACT);
  });

  it('a second dispatch before recover() finished cannot run; a failing recover refuses 503', async () => {
    const { deps } = makeDeps({ openLedger: () => ({ append: async () => undefined, rows: async () => { throw new Error('torn'); } }) });
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_ledger_unavailable' });
  });

  it('SOURCE SCAN: neither wiring module reads process.env', () => {
    for (const file of ['julius-dispatch-wiring.ts', 'julius-dispatch-wiring-real.ts']) {
      const code = readFileSync(join(__dirname, file), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      expect(code.filter((l) => /process\.env|process\['env'\]|process\[\"env\"\]/.test(l)), file).toEqual([]);
    }
  });
});

describe('Part B: the real builders are construct-only', () => {
  const frozen = { missionId: 'mission-1', contractSha256: 'a'.repeat(64) };

  it('the frozen run lookup answers for the configured project only, with the frozen record in state READY', async () => {
    const lookup = createFrozenRunLookup({ projectId: 'proj-1', frozen });
    expect(await lookup.lookup({ projectId: 'proj-1', runId: 'run:new' })).toEqual({ missionId: 'mission-1', contractSha256: 'a'.repeat(64), state: 'READY' });
    expect(await lookup.lookup({ projectId: 'proj-2', runId: 'run:new' })).toBeNull();
    expect(() => createFrozenRunLookup({ projectId: 'proj-1', frozen: { missionId: 'm', contractSha256: 'nothex' } })).toThrow('frozen_run_lookup_invalid');
  });

  it('realJ1WiringDeps supplies the coder builder, no shell, no run store, and performs no effect when constructed', () => {
    const logs: string[] = [];
    const deps = realJ1WiringDeps((l) => logs.push(l));
    expect(deps.coderProviderFor).not.toBeNull();
    expect(deps.shell).toBeNull();
    expect('runStore' in deps).toBe(false);
    expect(logs).toEqual([]);
    expect(J1_SHELL_PORT_MISSING.length).toBeGreaterThan(0);
    // a complete env still refuses on the shell, with the reason code
    const { deps: fakes } = makeDeps({ coderProviderFor: deps.coderProviderFor, shell: null });
    expect(createJ1LiveForTest(goodEnv(), fakes)).toMatchObject({ live: false, reason: 'dep_shell_absent' });
  });

  it('the real coder builder passes NO provider key, the subscription auth mode and the requested model to the hosted runner', async () => {
    const seen: { apiKey: string; authMode: unknown; requestedModel: unknown; workspacePath: string }[] = [];
    const build = buildJ1CoderProviderFor({
      queryLoader: async () => (async function* () { /* never iterated */ }) as never,
      run: (async (input: { apiKey: string; authMode?: unknown; requestedModel: string | null; workspacePath: string }) => {
        seen.push({ apiKey: input.apiKey, authMode: input.authMode, requestedModel: input.requestedModel, workspacePath: input.workspacePath });
        throw new Error('stop here: fake run');
      }) as never,
    });
    const provider = build({ PATH: '/bin' }, { requestedModel: 'claude-test-model' });
    expect(provider.providerKind).toBe('claude-code-hosted');
    const role = createCoderRoleProvider({ providerFor: (env) => build(env, { requestedModel: 'claude-test-model' }), shell: fakeShell(), projectId: 'proj-1', workerId: 'w', workspacePath: '/work', brief: 'B', model: 'claude-test-model', keyEnv: null, permittedPaths: ['out/normalized.json'] });
    const out = await role.call({ role: 'coder', runId: 'run:1', dispatchId: 'd1', missionId: 'mission-1', apiKey: '', architectText: 'PLAN', coderArtifact: null, coderEvidence: null });
    expect(out).toMatchObject({ ok: false, failureClass: 'provider_error' });
    expect(seen).toEqual([{ apiKey: '', authMode: J1_CODER_AUTH_MODE, requestedModel: 'claude-test-model', workspacePath: '/work' }]);
    expect(J1_CODER_AUTH_MODE).toBe('CLAUDE_SUBSCRIPTION');
  });

  it('the real coder builder refuses a key-like env name and an absent model', () => {
    const build = buildJ1CoderProviderFor();
    expect(() => build({ ANTHROPIC_API_KEY: 'x' }, { requestedModel: 'm' })).toThrow('coder_env_contains_secret_name');
    expect(() => build({ PATH: '/bin' }, { requestedModel: ' ' })).toThrow('coder_requested_model_absent');
  });

  it('the wiring hands the coder builder the requested model from the env, and the composed chain uses the frozen lookup (no run store)', async () => {
    const asked: string[] = [];
    const { deps } = makeDeps({ coderProviderFor: (_env, ctx) => { asked.push(ctx.requestedModel); return fakeCoder(); } });
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(await r.controller.dispatch(await echoed(r.controller))).toMatchObject({ ok: true });
    await r.controller.whenIdle();
    expect(asked).toEqual(['claude-test-model']);
    expect(await r.controller.dispatch({ ...dispatchInput, projectId: 'proj-other', idempotencyKey: 'key-0000002' })).toMatchObject({ ok: false });
  });
});

describe('C1: the test pins cannot reach production code', () => {
  const root = __dirname;
  const importsOf = (file: string): string[] => {
    const src = readFileSync(file, 'utf8');
    const out: string[] = [];
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/gu)) {
      const base = resolve(dirname(file), m[1]!);
      for (const cand of [`${base}.ts`, join(base, 'index.ts'), base]) if (existsSync(cand) && /\.ts$/u.test(cand)) { out.push(cand); break; }
    }
    return out;
  };
  const closure = (start: readonly string[]): string[] => {
    const seen = new Set<string>();
    const queue = [...start];
    while (queue.length > 0) {
      const f = queue.pop()!;
      if (seen.has(f) || /\.test\.ts$/u.test(f)) continue;
      seen.add(f);
      queue.push(...importsOf(f));
    }
    return [...seen];
  };
  const code = (file: string): string => readFileSync(file, 'utf8').split(/\r?\n/u).filter((l) => !/^\s*(\*|\/\/|\/\*)/u.test(l)).join(' ');

  it('SOURCE SCAN: server.ts and everything it imports never reference the test kit, createJ1LiveForTest or createJ1LiveDispatchWithPins', () => {
    const files = closure([join(root, 'server.ts')]);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(code(f), f).not.toMatch(/wiring-testkit|createJ1LiveForTest|TEST_PINS/u);
    expect(files.some((f) => /julius-dispatch-wiring-testkit/u.test(f))).toBe(false);
    expect(files.some((f) => /julius-dispatch-wiring\.ts$/u.test(f))).toBe(true);
  });

  it('SOURCE SCAN: the production factory and the files it imports carry no pin override (no `pinned` field, no pins parameter, no env switch)', () => {
    const files = closure([join(root, 'julius-dispatch-wiring.ts'), join(root, 'julius-dispatch-wiring-real.ts')]);
    for (const f of files.filter((x) => /julius-dispatch-wiring/u.test(x))) {
      const c = code(f);
      expect(c, f).not.toMatch(/pinned|NODE_ENV|wiring-testkit/u);
    }
    const prod = code(join(root, 'julius-dispatch-wiring.ts'));
    expect(prod).toMatch(/export function createJ1LiveDispatchFromEnv\(env: J1Env \| \(\(\) => J1Env\), deps: J1WiringDeps\)/u);
  });

  it('only the wiring core, the production factory (constants) and the test kit touch the pins-taking function', () => {
    const files = closure([join(root, 'server.ts')]);
    for (const f of files.filter((x) => !/julius-dispatch-wiring(-core)?\.ts$/u.test(x))) expect(code(f), f).not.toMatch(/createJ1LiveDispatchWithPins/u);
  });
});

describe('C2 at the wiring: the brief the roles get is the exact contract bytes', () => {
  it('a contract whose bytes do not survive a UTF-8 round trip is refused before any controller exists', () => {
    const bad = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    const badSha = sha(bad);
    const { deps } = makeDeps({ readFileSync: (path) => (path === '/pins/contract.json' ? bad : new TextEncoder().encode(FILES[path] ?? '')) });
    const r = createJ1LiveDispatchWithPins(goodEnv({ JULIUS_J1_CONTRACT_SHA256: badSha }), deps, { contractSha256: badSha, checkerSha256: PIN.checkerSha256 });
    expect(r).toMatchObject({ live: false, reason: 'brief_not_contract_bytes' });
  });

  it('a live dispatch records the brief hash (= the contract hash) in run_start', async () => {
    const { deps, probe } = makeDeps();
    const r = createJ1LiveForTest(goodEnv(), deps);
    await r.controller.dispatch(await echoed(r.controller));
    await r.controller.whenIdle();
    const start = (await probe.ledgers[0]!.rows()).find((row) => row.phase === 'run_start');
    expect(start).toMatchObject({ briefSha256: sha(FILES['/pins/contract.json']!), contractSha256: sha(FILES['/pins/contract.json']!) });
  });
});

describe('C3/C4 at the wiring', () => {
  it('the environment cannot widen the write set: anything but exactly out/normalized.json refuses', () => {
    for (const bad of ['out/normalized.json,data/posts.json', 'src/', 'out/other.json', 'data/posts.json,out/normalized.json']) {
      expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_CODER_PERMITTED_PATHS: bad }), makeDeps().deps), bad).toMatchObject({ live: false, reason: 'config_invalid_julius_j1_coder_permitted_paths' });
    }
  });
  it('a missing workspace fs refuses (dep_workspace_fs_absent); the real deps supply one without reading anything', () => {
    expect(createJ1LiveForTest(goodEnv(), makeDeps({ workspaceFs: null }).deps)).toMatchObject({ live: false, reason: 'dep_workspace_fs_absent' });
    expect(realJ1WiringDeps(() => undefined).workspaceFs).not.toBeNull();
  });
  it('END TO END (fakes): the coder result row carries both artifact hashes and the single changed path', async () => {
    const { deps, probe } = makeDeps();
    const r = createJ1LiveForTest(goodEnv(), deps);
    await r.controller.dispatch(await echoed(r.controller));
    await r.controller.whenIdle();
    const coder = (await probe.ledgers[0]!.rows()).find((row) => row.phase === 'result' && row.role === 'coder');
    expect(coder).toMatchObject({ outcome: 'ok', artifactJudgedSha256: sha(ARTIFACT), artifactFileSha256: sha(ARTIFACT), workspaceChangedPaths: 'out/normalized.json' });
  });
  it('END TO END (fakes): a coder that also edits an input file fails workspace_scope_violation and the chain stops before the reviewer', async () => {
    const { deps, probe } = makeDeps();
    probe.workspace['out/normalized.json'] = 'stale';
    const cheat = { providerKind: 'fake-coding', async execute() { probe.workspace['out/normalized.json'] = ARTIFACT; probe.workspace['data/posts.json'] = 'tampered'; return fakeCoder(probe.workspace).execute({} as never); } };
    const r = createJ1LiveForTest(goodEnv(), { ...deps, coderProviderFor: () => cheat as never });
    await r.controller.dispatch(await echoed(r.controller));
    await r.controller.whenIdle();
    const rows = await probe.ledgers[0]!.rows();
    expect(rows.find((row) => row.phase === 'result' && row.role === 'coder')).toMatchObject({ outcome: 'workspace_scope_violation' });
    expect(rows.some((row) => row.phase === 'pre_call' && row.role === 'reviewer')).toBe(false);
  });
});
