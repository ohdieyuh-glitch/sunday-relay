import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMemoryDispatchLedger } from './julius-dispatch';
import { createMemoryAdmissionStore } from './julius-dispatch-admission';
import { checkHostedRunnerDynamicImports, closureOf } from './julius-dispatch-source-scan';
import { createJ1LiveDispatchWithPins } from './julius-dispatch-wiring-core';
import { createCoderRoleProvider, createFrozenRunLookup, J1_CODER_KEY_ENV, J1_CODER_MODEL } from './julius-dispatch-adapters';
import { buildJ1CoderProviderFor, J1_CODER_AUTH_MODE, J1_SHELL_PORT_MISSING, j1PinnedFetchUrl, realJ1WiringDeps } from './julius-dispatch-wiring-real';
import { createJ1LiveDispatchFromEnv, J1_PAID_SLOT_SCRIPT, J1_PAID_WORKFLOW_FILE, J1_PINNED_CHECKER_FILE_SHA256, J1_PINNED_CHECKER_SHA256, J1_PINNED_CONTRACT_SHA256, J1_PINNED_ORACLE_SHA256 } from './julius-dispatch-wiring';
import { INWORLD_PIN_FILES, pinInworldFiles } from './julius-inworld-checker';
import {
  ARTIFACT, createJ1LiveForTest, dispatchInput, echoed, fakeCoder, fakeShell, FILES, goodEnv, KEY, KEY_DIR, makeDeps, PIN, sha,
} from './julius-dispatch-wiring-testkit';


const CLIENT_RUN = 'wlj_11111111-1111-4111-8111-111111111111';

describe('J1 live wiring (fakes only)', () => {
  it('the frozen pin constants are the bytes in this tree, and the checker file hash is not the combined pin', () => {
    const dir = join(__dirname, 'julius-inworld-mission', 'julius-inworld-data-1');
    expect(J1_PINNED_CHECKER_SHA256).toBe('0ca020dbfd2f971a8c112444961aa57ea0d113b0c1d86336f420fcae126eafd3');
    expect(J1_PINNED_CHECKER_FILE_SHA256).toBe('1a98f1a4d739ebe2da254715d81f56cd5fa08d534a1fbf10ef6214e8b262207e');
    expect(J1_PINNED_ORACLE_SHA256).toBe('50328c58bd828ce2595c977cb1b1ff973481215425b8192e9d341c3e70357323');
    expect(J1_PINNED_CHECKER_SHA256).not.toBe(J1_PINNED_CHECKER_FILE_SHA256);
    expect(sha(readFileSync(join(dir, 'contract.json')))).toBe(J1_PINNED_CONTRACT_SHA256);
    expect(sha(readFileSync(join(dir, 'checker/check.mjs')))).toBe(J1_PINNED_CHECKER_FILE_SHA256);
    expect(sha(readFileSync(join(dir, 'checker/oracle.mjs')))).toBe(J1_PINNED_ORACLE_SHA256);
    expect(pinInworldFiles(INWORLD_PIN_FILES.map((name) => [name, readFileSync(join(dir, name))] as const))).toBe(J1_PINNED_CHECKER_SHA256);
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

  it('the production factory is closed unless the caller is the paid workflow, and the frozen pins still refuse fake bytes', () => {
    const { deps } = makeDeps();
    expect(createJ1LiveDispatchFromEnv(goodEnv(), deps)).toMatchObject({ live: false, reason: 'julius_dispatch_paid_path_is_workflow' });
    expect(createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_PAID_WORKFLOW: J1_PAID_WORKFLOW_FILE }), deps)).toMatchObject({ live: false, reason: 'julius_dispatch_paid_path_is_workflow' });
    expect(createJ1LiveDispatchFromEnv(goodEnv({ JULIUS_PAID_SLOT: J1_PAID_SLOT_SCRIPT }), deps)).toMatchObject({ live: false, reason: 'julius_dispatch_paid_path_is_workflow' });
    const gated = goodEnv({ JULIUS_PAID_WORKFLOW: J1_PAID_WORKFLOW_FILE, JULIUS_PAID_SLOT: J1_PAID_SLOT_SCRIPT });
    expect(createJ1LiveDispatchFromEnv(gated, deps)).toMatchObject({ live: false, reason: 'pin_contract_sha256_not_the_frozen_value' });
  });

  it('a combined checker pin is not the file hash, and an oracle pin is checked on its own file', () => {
    const fileSha = sha(FILES['/pins/checker.mjs']!);
    const combined = 'ab'.repeat(32);
    expect(combined).not.toBe(fileSha);
    const split = createJ1LiveDispatchWithPins(goodEnv({ JULIUS_J1_CHECKER_SHA256: combined }), makeDeps().deps, { contractSha256: PIN.contractSha256, checkerSha256: combined, checkerFileSha256: fileSha });
    expect(split).toMatchObject({ live: true, reason: null });
    const sameHash = createJ1LiveDispatchWithPins(goodEnv({ JULIUS_J1_CHECKER_SHA256: combined }), makeDeps().deps, { contractSha256: PIN.contractSha256, checkerSha256: combined });
    expect(sameHash).toMatchObject({ live: false, reason: 'pin_checker_file_mismatch' });
    const oracleSha = sha('oracle bytes');
    const files = { ...FILES, '/pins/oracle.mjs': 'oracle bytes' };
    const oracleEnv = goodEnv({ JULIUS_J1_ORACLE_PATH: '/pins/oracle.mjs', JULIUS_J1_ORACLE_SHA256: oracleSha });
    expect(createJ1LiveDispatchWithPins(goodEnv(), makeDeps().deps, { ...PIN, oracleSha256: oracleSha })).toMatchObject({ live: false, reason: 'config_missing_julius_j1_oracle_path' });
    expect(createJ1LiveDispatchWithPins(oracleEnv, makeDeps({}, { ...files, '/pins/oracle.mjs': 'tampered' }).deps, { ...PIN, oracleSha256: oracleSha })).toMatchObject({ live: false, reason: 'pin_oracle_file_mismatch' });
    expect(createJ1LiveDispatchWithPins(oracleEnv, makeDeps({}, files).deps, { ...PIN, oracleSha256: 'cd'.repeat(32) })).toMatchObject({ live: false, reason: 'pin_oracle_sha256_not_the_frozen_value' });
    expect(createJ1LiveDispatchWithPins(oracleEnv, makeDeps({}, files).deps, { ...PIN, oracleSha256: oracleSha })).toMatchObject({ live: true, reason: null });
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

  it('a live dispatch does not call a provider: an unadmitted run id is refused before any fetch, spawn, key read or ledger row', async () => {
    const { deps, probe } = makeDeps();
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 400, code: 'julius_dispatch_run_invalid' });
    await r.controller.whenIdle();
    expect(await probe.ledgers[0]!.rows()).toEqual([]);
    expect(probe.fetched).toHaveLength(0);
    expect(probe.spawned).toHaveLength(0);
    expect(probe.keyReads).toEqual([]);
    expect(JSON.stringify(probe.logs)).not.toContain(KEY.openai);
    expect(JSON.stringify(probe.logs)).not.toContain(KEY.xai);
  });

  it('an admitted live run is the paid-workflow refusal: nothing is claimed and no provider is contacted', async () => {
    const claims = createMemoryAdmissionStore();
    const digest = createHash('sha256').update(CLIENT_RUN).digest('hex');
    claims.admit({ clientRunId: CLIENT_RUN, serverRunId: `run:${digest.slice(0, 24)}`, idempotencyKey: 'key-0000001', missionId: 'mission-1', state: 'admitted' });
    const { deps, probe } = makeDeps({ claims });
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r.live).toBe(true);
    const echoedInput = await echoed(r.controller);
    expect(await r.controller.dispatch({ ...echoedInput, runId: CLIENT_RUN })).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_paid_path_is_workflow' });
    await r.controller.whenIdle();
    expect(claims.status(CLIENT_RUN)).toBe('admitted');
    expect(probe.fetched).toHaveLength(0);
    expect(probe.spawned).toHaveLength(0);
    expect(probe.keyReads).toEqual([]);
    expect((await probe.ledgers[0]!.rows()).some((row) => row.phase === 'run_start')).toBe(false);
  });

  it('a second dispatch before recover() finished cannot run; a failing recover refuses 503', async () => {
    const { deps } = makeDeps({ openLedger: () => ({ append: async () => undefined, rows: async () => { throw new Error('torn'); } }) });
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_ledger_unavailable' });
  });

  it('SOURCE SCAN: neither wiring module reads process.env', () => {
    for (const file of ['julius-dispatch-wiring.ts', 'julius-dispatch-wiring-core.ts', 'julius-dispatch-wiring-real.ts']) {
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
    expect(deps.shellFor).not.toBeNull();
    expect('runStore' in deps).toBe(false);
    expect(logs).toEqual([]);
    expect(J1_SHELL_PORT_MISSING.length).toBeGreaterThan(0);
    // with neither a shell nor a shellFor the composition still refuses, with the reason code
    const { deps: fakes } = makeDeps({ coderProviderFor: deps.coderProviderFor, shell: null });
    expect(createJ1LiveForTest(goodEnv(), fakes)).toMatchObject({ live: false, reason: 'dep_shell_absent' });
    // with the real shellFor (construct-only: it spawns and writes nothing) the composition no longer refuses dep_shell_absent
    const { deps: withLocal, probe } = makeDeps({ coderProviderFor: deps.coderProviderFor, shell: null, shellFor: deps.shellFor });
    // the REAL shellFor re-reads and re-hashes the bash through the real file system: the fake path is unreadable, so the port refuses at construction (fail closed)
    expect(createJ1LiveForTest(goodEnv(), withLocal)).toMatchObject({ live: false, reason: 'composition_refused_local_shell_bash_unreadable' });
    expect(probe.spawned).toHaveLength(0);
  });

  it('the real coder builder passes NO provider key, the Anthropic API auth mode and the opus model to the hosted runner', async () => {
    const seen: { apiKey: string; authMode: unknown; requestedModel: unknown; workspacePath: string }[] = [];
    const build = buildJ1CoderProviderFor({
      queryLoader: async () => (async function* () { /* never iterated */ }) as never,
      run: (async (input: { apiKey: string; authMode?: unknown; requestedModel: string | null; workspacePath: string }) => {
        seen.push({ apiKey: input.apiKey, authMode: input.authMode, requestedModel: input.requestedModel, workspacePath: input.workspacePath });
        throw new Error('stop here: fake run');
      }) as never,
    });
    const provider = build({ PATH: '/bin' }, { requestedModel: J1_CODER_MODEL });
    expect(provider.providerKind).toBe('claude-code-hosted');
    const role = createCoderRoleProvider({ providerFor: (env) => build(env, { requestedModel: J1_CODER_MODEL }), shell: fakeShell(), projectId: 'proj-1', workerId: 'w', workspacePath: '/work', brief: 'B', model: J1_CODER_MODEL, keyEnv: J1_CODER_KEY_ENV, permittedPaths: ['out/normalized.json'] });
    const out = await role.call({ role: 'coder', runId: 'run:1', dispatchId: 'd1', missionId: 'mission-1', apiKey: '', architectText: 'PLAN', coderArtifact: null, coderEvidence: null });
    expect(out).toMatchObject({ ok: false, failureClass: 'provider_error' });
    expect(seen).toEqual([{ apiKey: '', authMode: J1_CODER_AUTH_MODE, requestedModel: J1_CODER_MODEL, workspacePath: '/work' }]);
    expect(J1_CODER_AUTH_MODE).toBe('ANTHROPIC_API');
  });

  it('the real coder builder refuses a key-like env name and an absent model', () => {
    const build = buildJ1CoderProviderFor();
    expect(() => build({ ANTHROPIC_API_KEY: 'x' }, { requestedModel: 'm' })).toThrow('coder_env_contains_secret_name');
    expect(() => build({ PATH: '/bin' }, { requestedModel: ' ' })).toThrow('coder_requested_model_absent');
  });

  it('the wiring refuses a coder model other than claude-opus-5-5, and a live dispatch never asks the coder builder', async () => {
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_CODER_MODEL: 'claude-test-model' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'coder_role_requires_anthropic_opus' });
    const asked: string[] = [];
    const { deps } = makeDeps({ coderProviderFor: (_env, ctx) => { asked.push(ctx.requestedModel); return fakeCoder(); } });
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(goodEnv().JULIUS_J1_CODER_MODEL).toBe(J1_CODER_MODEL);
    expect(await r.controller.dispatch(dispatchInput)).toMatchObject({ ok: false, status: 400, code: 'julius_dispatch_run_invalid' });
    await r.controller.whenIdle();
    expect(asked).toEqual([]);
    expect(await r.controller.dispatch({ ...dispatchInput, projectId: 'proj-other', idempotencyKey: 'key-0000002' })).toMatchObject({ ok: false, status: 403, code: 'julius_dispatch_wrong_project' });
  });
});

describe('C1: the test pins cannot reach production code', () => {
  const root = __dirname;
  const io = { read: (p: string): string => readFileSync(p, 'utf8'), exists: (p: string): boolean => existsSync(p) && statSync(p).isFile() };
  /* D3: resolves .js-suffixed specifiers, index files, require() and import() with a string literal; an unresolvable relative specifier or a
     non-literal dynamic import anywhere in the closure FAILS (a closure that cannot be proven is not clean). */
  const closure = (start: readonly string[]): string[] => {
    const c = closureOf(start, io);
    /* The ONE known false positive: fixture.ts holds the text of a stub source file in a template string (`from '../src/normalize.js'` is data, not an import). */
    const unresolved = c.unresolved.filter((u) => !(/claude-code.fixture.ts$/u.test(u.from) && u.spec === '../src/normalize.js'));
    expect(unresolved, 'unresolvable relative import in the closure').toEqual([]);
    /* NAMED ALLOWANCE (reviewable, tied to the exact call site): hosted-runner.ts loads the Agent SDK with `new Function('id', 'return import(id)')` where id is the constant HOSTED_SDK_PACKAGE. It is shared hosted code. Any OTHER non-literal dynamic import fails. */
    /* R1: the allowance is the EXACT call-site shape and specifier constant (checkHostedRunnerDynamicImports), not the file: a second import of any kind in that file, or a changed specifier, fails here. */
    const runner = c.nonLiteralDynamic.filter((f) => /hosted-coding-agent.hosted-runner.ts$/u.test(f));
    for (const f of runner) expect(checkHostedRunnerDynamicImports(io.read(f), io.read(join(dirname(f), 'hosted-readiness.ts'))), 'hosted-runner dynamic import is not the exact allowed shape').toEqual([]);
    const nonLiteral = c.nonLiteralDynamic.filter((f) => !runner.includes(f));
    expect(nonLiteral, 'non-literal dynamic import in the closure').toEqual([]);
    return c.files;
  };
  const code = (file: string): string => readFileSync(file, 'utf8').split(/\r?\n/u).filter((l) => !/^\s*(\*|\/\/|\/\*)/u.test(l)).join(' ');

  it('SOURCE SCAN: server.ts does not import the J1 wiring while that file overlaps the admission draft', () => {
    const files = closure([join(root, 'server.ts')]);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(code(f), f).not.toMatch(/wiring-testkit|createJ1LiveForTest|TEST_PINS|createJ1LiveDispatchWithPins/u);
    expect(files.some((f) => /julius-dispatch-wiring/u.test(f))).toBe(false);
    expect(files.some((f) => /julius-dispatch\.ts$/u.test(f))).toBe(false);
  });

  it('SOURCE SCAN: the production wiring closure includes the factory and excludes the test kit', () => {
    const files = closure([join(root, 'julius-dispatch-wiring.ts'), join(root, 'julius-dispatch-wiring-real.ts')]);
    expect(files.some((f) => /julius-dispatch-wiring\.ts$/u.test(f))).toBe(true);
    expect(files.some((f) => /julius-dispatch-wiring-testkit/u.test(f))).toBe(false);
    for (const f of files) expect(code(f), f).not.toMatch(/wiring-testkit|createJ1LiveForTest|TEST_PINS/u);
  });

  it('SOURCE SCAN: the production factory and the files it imports carry no pin override (no `pinned` field, no pins parameter, no env switch)', () => {
    const files = closure([join(root, 'julius-dispatch-wiring.ts'), join(root, 'julius-dispatch-wiring-real.ts')]);
    for (const f of files.filter((x) => /julius-dispatch-wiring/u.test(x))) {
      const c = code(f);
      expect(c, f).not.toMatch(/pinned|NODE_ENV|wiring-testkit/u);
    }
    const prod = code(join(root, 'julius-dispatch-wiring.ts'));
    expect(prod).toMatch(/export function createJ1LiveDispatchFromEnv\(env: J1Env \| \(\(\) => J1Env\), deps: J1WiringDeps\)/u);
    const core = code(join(root, 'julius-dispatch-wiring-core.ts'));
    expect(core).toMatch(/checkerSha256: checkerFileSha/u);
    expect(core).toMatch(/companions/u);
    const real = code(join(root, 'julius-dispatch-wiring-real.ts'));
    expect(real).toMatch(/O_NOFOLLOW/u);
    expect(real).toMatch(/ownerUid/u);
    expect(real).toMatch(/redirect: 'error'/u);
    expect(real).not.toMatch(/CLAUDE_SUBSCRIPTION/u);
    expect(real).not.toMatch(/\bstatSync\b/u);
  });

  it('only the wiring core and the production factory touch the pins-taking function', () => {
    const files = closure([join(root, 'julius-dispatch-wiring.ts')]);
    expect(files.some((f) => /julius-dispatch-wiring-core\.ts$/u.test(f))).toBe(true);
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

  it('a live dispatch writes no run_start row, so the brief hash is not recorded on this route', async () => {
    const { deps, probe } = makeDeps();
    const r = createJ1LiveForTest(goodEnv(), deps);
    await r.controller.dispatch(await echoed(r.controller));
    await r.controller.whenIdle();
    expect((await probe.ledgers[0]!.rows()).some((row) => row.phase === 'run_start')).toBe(false);
    expect(probe.fetched).toHaveLength(0);
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
  it('a live dispatch never starts the coder, so a cheat that would edit an input file or node_modules writes nothing', async () => {
    const { deps, probe } = makeDeps();
    let called = 0;
    const cheat = { providerKind: 'fake-coding', async execute() { called += 1; probe.workspace['out/normalized.json'] = ARTIFACT; probe.workspace['data/posts.json'] = 'tampered'; probe.workspace['node_modules/evil/index.js'] = 'x'; return fakeCoder(probe.workspace).execute({} as never); } };
    const r = createJ1LiveForTest(goodEnv(), { ...deps, coderProviderFor: () => { called += 1; return cheat as never; } });
    await r.controller.dispatch(await echoed(r.controller));
    await r.controller.whenIdle();
    expect(called).toBe(0);
    expect(probe.workspace['data/posts.json']).toBe('[]');
    expect(probe.workspace['node_modules/evil/index.js']).toBeUndefined();
    expect(probe.fetched).toHaveLength(0);
    expect((await probe.ledgers[0]!.rows()).some((row) => row.phase === 'result' || row.phase === 'bundle_lists' || row.phase === 'pre_call')).toBe(false);
    const res = r.controller.result({ projectId: dispatchInput.projectId, runId: dispatchInput.runId, callerPlayerId: dispatchInput.callerPlayerId });
    expect(JSON.stringify(res)).not.toContain(ARTIFACT);
  });
  it('PART 2: provider keys never live in process.env: a logical key name present in the env refuses at composition (reason code only)', () => {
    for (const over of [{ XAI_API_KEY: KEY.xai }, { OPENAI_API_KEY: KEY.openai }, { XAI_API_KEY: '' }]) {
      const { deps, probe } = makeDeps();
      const r = createJ1LiveForTest(goodEnv(over), deps);
      expect(r).toMatchObject({ live: false, reason: 'provider_key_in_env' });
      expect(probe.ledgers).toHaveLength(0);
      expect(probe.logs.join('\n')).not.toMatch(/canary_|ZZ9/);
    }
  });
  it('PART 2: JULIUS_J1_KEY_DIR is required; a missing key-store dependency or an unreadable key refuses', () => {
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_KEY_DIR: undefined }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_missing_julius_j1_key_dir' });
    expect(createJ1LiveForTest(goodEnv(), makeDeps({ keyStoreFor: null }).deps)).toMatchObject({ live: false, reason: 'dep_key_store_absent' });
    const absent = makeDeps({ keyStoreFor: () => ({ has: (n: string) => n !== 'XAI_API_KEY', getKey: () => { throw new Error('key_file_absent'); } }) });
    expect(createJ1LiveForTest(goodEnv(), absent.deps)).toMatchObject({ live: false, reason: 'key_store_key_unavailable' });
    const ctor = makeDeps({ keyStoreFor: () => { throw new Error('key_dir_inside_repo'); } });
    expect(createJ1LiveForTest(goodEnv(), ctor.deps)).toMatchObject({ live: false, reason: 'key_store_unavailable' });
    expect(absent.probe.logs.join('\n')).not.toContain(KEY_DIR);
  });
  it('PART 2: a live dispatch does not read the key store and does not fetch, including a store that would throw', async () => {
    const { deps, probe } = makeDeps();
    const r = createJ1LiveForTest(goodEnv(), deps);
    expect(r.live).toBe(true);
    expect(probe.keyDirs).toEqual([KEY_DIR]);
    expect(probe.keyReads).toEqual([]);
    expect(await r.controller.dispatch(await echoed(r.controller))).toMatchObject({ ok: false, status: 400, code: 'julius_dispatch_run_invalid' });
    await r.controller.whenIdle();
    expect(probe.keyReads).toEqual([]);
    expect(probe.fetched).toHaveLength(0);
    const everything = JSON.stringify(await probe.ledgers[0]!.rows()) + probe.logs.join('\n');
    for (const secret of [KEY.openai, KEY.xai, KEY_DIR, 'ZZ9']) expect(everything).not.toContain(secret);
    let reads = 0;
    const throwing = makeDeps({ keyStoreFor: () => ({ has: () => true, getKey: () => { reads += 1; throw new Error('key_file_absent'); } }) });
    const refused = createJ1LiveForTest(goodEnv(), throwing.deps);
    expect(refused.live).toBe(true);
    expect(await refused.controller.dispatch(await echoed(refused.controller))).toMatchObject({ ok: false, status: 400, code: 'julius_dispatch_run_invalid' });
    expect(reads).toBe(0);
    expect(throwing.probe.fetched).toHaveLength(0);
  });
  it('PART 3: a shellFor dependency supplies the shell: it is given the configured workspace path and the three pinned seed files (re-hashed), nothing else', () => {
    const seen: { workspacePath: string; files: { name: string; text: string; sha256: string }[] }[] = [];
    const { deps } = makeDeps({ shell: null, shellFor: (ctx) => { seen.push({ workspacePath: ctx.workspacePath, files: ctx.seedFiles.map((f) => ({ name: f.name, text: new TextDecoder().decode(f.bytes), sha256: f.sha256 })) }); return fakeShell(); } });
    expect(createJ1LiveForTest(goodEnv(), deps)).toMatchObject({ live: true, reason: null });
    expect(seen).toEqual([{ workspacePath: '/work', files: [
      { name: 'data/legacy_ledger.csv', text: FILES['/pins/ledger.csv'], sha256: sha(FILES['/pins/ledger.csv']!) },
      { name: 'data/posts.json', text: FILES['/pins/posts.json'], sha256: sha(FILES['/pins/posts.json']!) },
      { name: 'format.test.mjs', text: FILES['/pins/format.test.mjs'], sha256: sha(FILES['/pins/format.test.mjs']!) },
    ] }]);
  });
  it('D-2: JULIUS_J1_BASH_PATH is required, must be absolute and must exist (injected pathExists); PATH is never searched; it reaches shellFor', () => {
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_BASH_PATH: undefined }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_missing_julius_j1_bash_path' });
    for (const bad of ['bash', 'bash.exe', 'bin/bash']) expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_BASH_PATH: bad }), makeDeps().deps), bad).toMatchObject({ live: false, reason: 'config_invalid_julius_j1_bash_path' });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_BASH_PATH: '/nowhere/bash' }), makeDeps({ pathExists: () => false }).deps)).toMatchObject({ live: false, reason: 'bash_path_not_found' });
    expect(createJ1LiveForTest(goodEnv(), makeDeps({ pathExists: null }).deps)).toMatchObject({ live: false, reason: 'dep_path_exists_absent' });
    const asked: string[] = []; const seen: string[] = [];
    const { deps } = makeDeps({ shell: null, pathExists: (p) => { asked.push(p); return true; }, shellFor: (ctx) => { seen.push(ctx.bashPath); return fakeShell(); } });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_BASH_PATH: '/opt/git/usr/bin/bash' }), deps)).toMatchObject({ live: true });
    expect(asked).toEqual(['/opt/git/usr/bin/bash', '/opt/git/cmd']);
    expect(seen).toEqual(['/opt/git/usr/bin/bash']);
  });
  it('real child PATH: JULIUS_J1_BASH_SHA256 and JULIUS_J1_GIT_DIR are required; the bash bytes must hash to the pin; the git directory must be absolute and exist; both reach shellFor', () => {
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_BASH_SHA256: undefined }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_missing_julius_j1_bash_sha256' });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_BASH_SHA256: 'abc' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_invalid_julius_j1_bash_sha256' });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_BASH_SHA256: 'f'.repeat(64) }), makeDeps().deps)).toMatchObject({ live: false, reason: 'pin_bash_sha256_mismatch' });
    expect(createJ1LiveForTest(goodEnv(), makeDeps({}, { ...FILES, '/opt/git/usr/bin/bash': 'a wsl bash' }).deps)).toMatchObject({ live: false, reason: 'pin_bash_sha256_mismatch' });
    const noBash = { ...FILES }; delete noBash['/opt/git/usr/bin/bash'];
    expect(createJ1LiveForTest(goodEnv(), makeDeps({}, noBash).deps)).toMatchObject({ live: false, reason: 'pin_bash_unreadable' });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_GIT_DIR: undefined }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_missing_julius_j1_git_dir' });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_GIT_DIR: 'git/cmd' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_invalid_julius_j1_git_dir' });
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_GIT_DIR: '/nowhere/cmd' }), makeDeps().deps)).toMatchObject({ live: false, reason: 'git_dir_not_found' });
    const seen: { bashSha256: string; gitDir: string }[] = [];
    const { deps } = makeDeps({ shell: null, shellFor: (ctx) => { seen.push({ bashSha256: ctx.bashSha256, gitDir: ctx.gitDir }); return fakeShell(); } });
    expect(createJ1LiveForTest(goodEnv(), deps)).toMatchObject({ live: true });
    expect(seen).toEqual([{ bashSha256: sha(FILES['/opt/git/usr/bin/bash']!), gitDir: '/opt/git/cmd' }]);
  });
  it('D-4 a provider key injected into the env accessor BETWEEN composition and dispatch refuses 503 julius_dispatch_provider_key_in_env: no ledger row, no provider call, no key read', async () => {
    for (const name of ['OPENAI_API_KEY', 'XAI_API_KEY', 'ANTHROPIC_API_KEY']) {
      const { deps, probe } = makeDeps();
      const live: Record<string, string | undefined> = goodEnv();
      const r = createJ1LiveForTest(() => live, deps);
      expect(r).toMatchObject({ live: true });
      const input = await echoed(r.controller);
      live[name] = KEY.openai;                                 // appears AFTER composition
      const out = await r.controller.dispatch(input);
      expect(out, name).toMatchObject({ ok: false, status: 503, code: 'julius_dispatch_provider_key_in_env' });
      await r.controller.whenIdle();
      expect(await probe.ledgers[0]!.rows(), name).toEqual([]);
      expect(probe.fetched, name).toHaveLength(0);
      expect(probe.keyReads, name).toEqual([]);
      expect(JSON.stringify(out) + probe.logs.join('\n')).not.toContain(KEY.openai);
    }
  });
  it('D-5: shell evidence is not copied onto a coder row, because a live dispatch never reaches the coder', async () => {
    let evidenceReads = 0;
    const ev = { indexSha256AfterStart: 'a'.repeat(64), indexSha256BeforeClose: 'a'.repeat(64), bashSha256: 'b'.repeat(64) };
    const shell = { ...fakeShell(), evidence: () => { evidenceReads += 1; return ev; } };
    const { deps, probe } = makeDeps({ shell });
    const r = createJ1LiveForTest(goodEnv(), deps);
    await r.controller.dispatch(await echoed(r.controller));
    await r.controller.whenIdle();
    expect(evidenceReads).toBe(0);
    expect((await probe.ledgers[0]!.rows()).some((row) => row.role === 'coder')).toBe(false);
  });
  it('the real fetch refuses an unpinned origin and sends redirect error on a pinned one', async () => {
    expect(() => j1PinnedFetchUrl('https://evil.example.com/v1/responses')).toThrow('provider_base_url_unpinned');
    expect(() => j1PinnedFetchUrl('https://api.x.ai.evil.example.com/v1/responses')).toThrow('provider_base_url_unpinned');
    expect(() => j1PinnedFetchUrl('https://user:pw@api.x.ai/v1/responses')).toThrow('provider_base_url_unpinned');
    expect(j1PinnedFetchUrl('https://api.openai.com/v1/responses')).toBe('https://api.openai.com/v1/responses');
    expect(j1PinnedFetchUrl('https://api.anthropic.com/v1/messages')).toBe('https://api.anthropic.com/v1/messages');
    const deps = realJ1WiringDeps(() => undefined);
    await expect(deps.fetchImpl('https://evil.example.com/v1/responses', { method: 'POST', headers: {}, body: '{}', redirect: 'error' })).rejects.toThrow('provider_base_url_unpinned');
    const seen: RequestInit[] = [];
    const saved = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { seen.push(init ?? {}); return new Response('{}', { status: 200 }); }) as typeof fetch;
    try {
      const out = await deps.fetchImpl('https://api.x.ai/v1/responses', { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{}', redirect: 'error' });
      expect(out.ok).toBe(true);
    } finally { globalThis.fetch = saved; }
    expect(seen).toHaveLength(1);
    expect(seen[0]!.redirect).toBe('error');
  });
  it('the real key store refuses a symlink, a group-readable file, and a directory inside the repo', () => {
    const repo = mkdtempSync(join(tmpdir(), 'j1-repo-'));
    const dir = mkdtempSync(join(tmpdir(), 'j1-keys-'));
    try {
      const deps = realJ1WiringDeps(() => undefined, Date.now, {}, repo);
      expect(() => deps.keyStoreFor!(repo)).toThrow('key_dir_inside_repo');
      const store = deps.keyStoreFor!(dir);
      const key = join(dir, 'OPENAI_API_KEY');
      writeFileSync(key, 'k', { mode: 0o600 });
      chmodSync(key, 0o600);
      expect(store.has('OPENAI_API_KEY')).toBe(true);
      expect(store.getKey('OPENAI_API_KEY')).toBe('k');
      chmodSync(key, 0o640);
      expect(store.has('OPENAI_API_KEY')).toBe(false);
      expect(() => store.getKey('OPENAI_API_KEY')).toThrow('key_file_mode_too_open');
      chmodSync(key, 0o604);
      expect(() => store.getKey('OPENAI_API_KEY')).toThrow('key_file_mode_too_open');
      chmodSync(key, 0o600);
      const link = join(dir, 'XAI_API_KEY');
      symlinkSync(key, link);
      expect(store.has('XAI_API_KEY')).toBe(false);
      expect(() => store.getKey('XAI_API_KEY')).toThrow('key_file_symlink');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('PART 3: the format test seed pin is required and must match its file', () => {
    expect(createJ1LiveForTest(goodEnv({ JULIUS_J1_SEED_FORMAT_TEST_PATH: undefined }), makeDeps().deps)).toMatchObject({ live: false, reason: 'config_missing_julius_j1_seed_format_test_path' });
    expect(createJ1LiveForTest(goodEnv(), makeDeps({}, { ...FILES, '/pins/format.test.mjs': 'other' }).deps)).toMatchObject({ live: false, reason: 'pin_seed_format_test_file_mismatch' });
  });
});
