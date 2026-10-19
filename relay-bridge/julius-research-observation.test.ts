import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  observeResearchAllowances,
  observeResearchCommand,
  observedResearchBackends,
  researchReachSummary,
  RESEARCH_NOT_GRANTED_LINE,
  RESEARCH_OBSERVED_ENV_PREFIX,
  type LiveMissionResearchClause,
} from './julius-live-mission';

/**
 * `observe-research` — THE OBSERVATION `run` REFUSES TO INVENT, MADE BY RELAY.
 *
 * WHY THIS EXISTS. Live Reach refuses a capability no backend has been
 * OBSERVED serving, and that observation arrives only through
 * `JULIUS_RESEARCH_OBSERVED_BACKENDS`. The paid workflow never set it, so a
 * mission whose contract granted research ran with every governed retrieval
 * refused — and could still complete, which is a qualification proving the
 * opposite of what it was dispatched to show. The design is explicit that the
 * observation is an OPERATOR's, not the contract's; so the repair is not to let
 * the contract vouch for itself, and not to hard-code the variable, but to make
 * a real, side-effect-free probe through Relay's own bounded fetch and print
 * the claim `run` already knows how to read.
 *
 * WHAT THESE CASES HOLD:
 *   - only `observed` becomes a claim; every other answer, and every exception,
 *     is printed and never rounded up;
 *   - a contract granting research of which nothing was observed FAILS CLOSED;
 *   - a contract granting none prints that, and no claim;
 *   - an action capability is never probed and never claimed;
 *   - the claim is distinct, and round-trips through `observedResearchBackends`
 *     unchanged, so the line this prints is a line `run` accepts;
 *   - every line printed is one the workflow's evidence allowlist admits.
 *
 * No case here touches a network: the fetch is injected, and the spawned
 * bundle is only ever given a contract with no research clause.
 */

/* ------------------------------------------------------------- fixtures */

const CONTRACT_BASE = Object.freeze({
  missionId: 'mission:research-observation',
  markerNamespace: 'julius-research-observation',
  projectId: 'prj-research-observation',
  tenantId: 'tenant',
  objective: 'Prove the research observation.',
  testCommand: 'npm test',
  workspacePath: '/tmp/research-observation-workspace',
  acceptanceCriteria: [{ id: 'c1', text: 'It holds.', blocking: true }],
  limits: { spendUsd: 1, repairCycles: 0 },
});

const clauseFor = (allowances: LiveMissionResearchClause['allowances']): LiveMissionResearchClause => ({
  roles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
  allowances,
  missionBudget: { maxRetrievals: 6, maxBytes: 400_000 },
  roleBudget: { maxRetrievals: 2, maxBytes: 200_000 },
});

const contractWith = (research?: LiveMissionResearchClause): string =>
  JSON.stringify(research === undefined ? CONTRACT_BASE : { ...CONTRACT_BASE, research });

type Answer = number | 'throw';

/**
 * A FETCH THAT ANSWERS PER HOST, AND REMEMBERS EVERY URL IT WAS ASKED FOR.
 * A host it has no answer for throws, which is the network being absent — so a
 * case that forgets to name a host cannot quietly read as observed.
 */
const fakeFetch = (answers: Readonly<Record<string, Answer>>) => {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const answer = answers[new URL(url).hostname];
    if (answer === undefined || answer === 'throw') throw new TypeError('fetch failed');
    return new Response(answer >= 200 && answer < 300 ? '<html>ok</html>' : '', {
      status: answer,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }) as typeof fetch;
  return { impl, calls };
};

const runCommand = async (contract: string, answers: Readonly<Record<string, Answer>>) => {
  const fetch = fakeFetch(answers);
  const out: string[] = [];
  const err: string[] = [];
  const code = await observeResearchCommand({
    contractPath: 'contract.json',
    readFile: () => contract,
    fetchImpl: fetch.impl,
    out: (line) => { out.push(line); },
    err: (line) => { err.push(line); },
  });
  return { code, out, err, calls: fetch.calls };
};

const claimOf = (lines: readonly string[]): readonly string[] =>
  lines.filter((line) => line.startsWith(RESEARCH_OBSERVED_ENV_PREFIX));

const POSTGRES = clauseFor([{ source: 'web', capabilities: ['read_item'], hosts: ['www.postgresql.org'] }]);

/* ------------------------------------------------------ the command */

describe('observe-research, against an injected fetch', () => {
  it('1. an observed host prints its row and exactly one claim, and exits 0', async () => {
    const result = await runCommand(contractWith(POSTGRES), { 'www.postgresql.org': 200 });
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out).toContain(
      'research_observation source=web capability=read_item host=www.postgresql.org backend=relay_http_fetch result=observed',
    );
    expect(claimOf(result.out)).toEqual(['JULIUS_RESEARCH_OBSERVED_BACKENDS=relay_http_fetch:read_item']);
    // A GET of the host root, through liveFetch — nothing else was requested.
    expect(result.calls).toEqual(['https://www.postgresql.org/']);
  });

  it('2. FAIL CLOSED: research granted and nothing observed exits 1, names research_unobservable, and claims nothing', async () => {
    const result = await runCommand(contractWith(POSTGRES), { 'www.postgresql.org': 503 });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('research_unobservable');
    expect(claimOf(result.out)).toEqual([]);
    expect(result.out).toContain(
      'research_observation source=web capability=read_item host=www.postgresql.org backend=relay_http_fetch result=unreachable',
    );
  });

  it('3. a contract with no research clause says so, probes nothing, claims nothing, and exits 0', async () => {
    const result = await runCommand(contractWith(), {});
    expect(result.code).toBe(0);
    expect(result.out).toEqual([RESEARCH_NOT_GRANTED_LINE]);
    expect(result.calls).toEqual([]);
  });

  it('4. UNKNOWN IS NOT ZERO: a fetch that throws is unreachable, never observed', async () => {
    const result = await runCommand(contractWith(POSTGRES), { 'www.postgresql.org': 'throw' });
    expect(result.code).toBe(1);
    expect(result.out.some((line) => line.endsWith('result=unreachable'))).toBe(true);
    expect(result.out.some((line) => line.endsWith('result=observed'))).toBe(false);
  });

  it('4b. a throw liveFetch does not catch (the body read, after a 200) is unreachable too, not a crash and not observed', async () => {
    // The status line said 200. The document never arrived, so nothing was
    // served — and a 200 alone is exactly the thing a lazy mapping rounds up.
    const impl = (async () => ({
      status: 200, ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => { throw new Error('connection reset mid-body'); },
    })) as unknown as typeof fetch;
    const { rows, pairs } = await observeResearchAllowances(POSTGRES.allowances, { fetchImpl: impl });
    expect(rows.map((row) => row.result)).toEqual(['unreachable']);
    expect(pairs).toEqual([]);
  });

  it('5. mixed hosts: partial observation exits 0, and EVERY unobserved host is still printed', async () => {
    const clause = clauseFor([{
      source: 'web', capabilities: ['read_item'],
      hosts: ['www.postgresql.org', 'docs.python.org', 'api.example.org', 'rate.example.org'],
    }]);
    const result = await runCommand(contractWith(clause), {
      'www.postgresql.org': 200, 'docs.python.org': 'throw', 'api.example.org': 401, 'rate.example.org': 429,
    });
    expect(result.code).toBe(0);
    const rows = result.out.filter((line) => line.startsWith('research_observation '));
    expect(rows).toHaveLength(4);
    expect(rows).toContain('research_observation source=web capability=read_item host=docs.python.org backend=relay_http_fetch result=unreachable');
    expect(rows).toContain('research_observation source=web capability=read_item host=api.example.org backend=relay_http_fetch result=unauthenticated');
    expect(rows).toContain('research_observation source=web capability=read_item host=rate.example.org backend=relay_http_fetch result=throttled');
    expect(result.out).toContain('research_observation_summary observed=1 of=4');
    expect(claimOf(result.out)).toEqual(['JULIUS_RESEARCH_OBSERVED_BACKENDS=relay_http_fetch:read_item']);
  });

  it('5b. throttled and unauthenticated hosts ANSWERED, but they did not serve: alone they fail closed', async () => {
    const clause = clauseFor([{ source: 'web', capabilities: ['read_item'], hosts: ['api.example.org', 'rate.example.org'] }]);
    const result = await runCommand(contractWith(clause), { 'api.example.org': 403, 'rate.example.org': 429 });
    expect(result.code).toBe(1);
    expect(claimOf(result.out)).toEqual([]);
  });

  it('6. the claim is DISTINCT: three observed hosts on one backend and capability are one pair', async () => {
    const clause = clauseFor([
      { source: 'web', capabilities: ['read_item'], hosts: ['a.example.org', 'b.example.org', 'c.example.org'] },
      { source: 'rss', capabilities: ['read_feed'], hosts: ['a.example.org', 'b.example.org'] },
    ]);
    const result = await runCommand(contractWith(clause), { 'a.example.org': 200, 'b.example.org': 200, 'c.example.org': 200 });
    expect(result.code).toBe(0);
    // Two allowances, five triples, five GETs — and two pairs, in contract order.
    expect(result.calls).toHaveLength(5);
    expect(claimOf(result.out)).toEqual(['JULIUS_RESEARCH_OBSERVED_BACKENDS=relay_http_fetch:read_item,relay_rss_fetch:read_feed']);
  });

  it('6b. the backend is the registry’s preferred candidate, as LiveReachService.probe reports it', async () => {
    const clause = clauseFor([{ source: 'github', capabilities: ['read_item', 'search'], hosts: ['api.github.com'] }]);
    const result = await runCommand(contractWith(clause), { 'api.github.com': 200 });
    expect(result.code).toBe(0);
    expect(claimOf(result.out)).toEqual(['JULIUS_RESEARCH_OBSERVED_BACKENDS=relay_github_public:read_item,relay_github_public:search']);
  });

  it('7. ROUND TRIP: the claim this prints is accepted by observedResearchBackends unchanged, and makes the clause ready', async () => {
    const clause = clauseFor([
      { source: 'web', capabilities: ['read_item', 'read_feed'], hosts: ['www.postgresql.org'] },
      { source: 'github', capabilities: ['search'], hosts: ['api.github.com'] },
    ]);
    const result = await runCommand(contractWith(clause), { 'www.postgresql.org': 200, 'api.github.com': 200 });
    const [claim] = claimOf(result.out);
    expect(claim).toBeDefined();
    const value = claim.slice(RESEARCH_OBSERVED_ENV_PREFIX.length);
    const parsed = observedResearchBackends({ JULIUS_RESEARCH_OBSERVED_BACKENDS: value });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.probes.map((probe) => `${probe.backendId}:${probe.capability}`)).toEqual(value.split(','));
    // And `run` would now read every authorised pair as ready — the point.
    expect(researchReachSummary(clause, parsed.probes).map((row) => row.readiness)).toEqual(['ready', 'ready', 'ready']);
  });

  it('7b. and a contract whose research is unobservable leaves run exactly where it was: nothing ready', async () => {
    const result = await runCommand(contractWith(POSTGRES), {});
    expect(result.code).toBe(1);
    const parsed = observedResearchBackends({});
    expect(parsed.ok && researchReachSummary(POSTGRES, parsed.probes).every((row) => row.readiness !== 'ready')).toBe(true);
  });

  it('8. NEVER AN ACTION: an action capability is not probed and not claimed, even handed in raw', async () => {
    const fetch = fakeFetch({ 'www.postgresql.org': 200 });
    const { rows, pairs } = await observeResearchAllowances(
      [{ source: 'web', capabilities: ['post', 'reply'], hosts: ['www.postgresql.org'] }],
      { fetchImpl: fetch.impl },
    );
    expect(fetch.calls).toEqual([]);
    expect(pairs).toEqual([]);
    expect(rows.map((row) => `${row.capability}:${row.backendId}:${row.result}`)).toEqual(['post:none:unconfigured', 'reply:none:unconfigured']);
  });

  it('8b. and the contract path cannot carry one at all: the shared parser refuses it before any probe', async () => {
    const clause = clauseFor([{ source: 'web', capabilities: ['post'], hosts: ['www.postgresql.org'] }]);
    const result = await runCommand(contractWith(clause), { 'www.postgresql.org': 200 });
    expect(result.code).toBe(2);
    expect(result.out.join('\n')).toContain('research_policy_action_capability');
    expect(result.calls).toEqual([]);
  });

  it('9. a wildcard host is a pattern, not an address: reported unconfigured and never probed', async () => {
    const clause = clauseFor([{ source: 'web', capabilities: ['read_item'], hosts: ['*.python.org'] }]);
    const result = await runCommand(contractWith(clause), { 'python.org': 200, 'www.python.org': 200 });
    expect(result.calls).toEqual([]);
    expect(result.code).toBe(1);
    expect(result.out).toContain('research_observation source=web capability=read_item host=*.python.org backend=relay_http_fetch result=unconfigured');
  });

  it('10. a capability no backend implements has no backend to observe: none, unconfigured, not probed', async () => {
    const clause = clauseFor([{ source: 'web', capabilities: ['search'], hosts: ['www.postgresql.org'] }]);
    const result = await runCommand(contractWith(clause), { 'www.postgresql.org': 200 });
    expect(result.calls).toEqual([]);
    expect(result.code).toBe(1);
    expect(result.out).toContain('research_observation source=web capability=search host=www.postgresql.org backend=none result=unconfigured');
  });

  it('11. Relay’s own network policy decides, not the contract: a redirect to a private address is not an observation', async () => {
    const impl = (async () => new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })) as typeof fetch;
    const { rows, pairs } = await observeResearchAllowances(POSTGRES.allowances, { fetchImpl: impl });
    expect(rows.map((row) => row.result)).toEqual(['unconfigured']);
    expect(pairs).toEqual([]);
  });

  it('12. an unreadable or refused contract is a usage refusal (2), never an observation', async () => {
    expect((await runCommand('{not json', {})).code).toBe(2);
    const noPath = await observeResearchCommand({ contractPath: null, out: () => undefined, err: () => undefined });
    expect(noPath).toBe(2);
    const unreadable: string[] = [];
    const code = await observeResearchCommand({
      contractPath: 'missing.json',
      readFile: () => { throw new Error('ENOENT'); },
      out: (line) => { unreadable.push(line); },
      err: () => undefined,
    });
    expect(code).toBe(2);
    expect(claimOf(unreadable)).toEqual([]);
  });

  it('13. prints no response body and no header — five closed fields per probe and nothing else', async () => {
    const impl = (async () => new Response('SECRET-BODY-MARKER', {
      status: 200, headers: { 'content-type': 'text/html', 'x-echo': 'SECRET-HEADER-MARKER' },
    })) as typeof fetch;
    const out: string[] = [];
    await observeResearchCommand({
      contractPath: 'c', readFile: () => contractWith(POSTGRES), fetchImpl: impl,
      out: (line) => { out.push(line); }, err: (line) => { out.push(line); },
    });
    expect(out.join('\n')).not.toContain('SECRET');
  });
});

/* ------------------------------------------- the workflow reads what this prints */

describe('every line observe-research prints is one the workflow admits', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/julius-first-live-mission.yml'), 'utf8');
  const evidencePattern = new RegExp(/grep -E '([^']+)' research-observation\.log/u.exec(workflow)?.[1] ?? '^$', 'u');
  const claimPattern = new RegExp(/claim='([^']+)'/u.exec(workflow)?.[1] ?? '^$', 'u');

  it('the evidence allowlist keeps every line, on every outcome', async () => {
    const outcomes = [
      await runCommand(contractWith(POSTGRES), { 'www.postgresql.org': 200 }),
      await runCommand(contractWith(POSTGRES), { 'www.postgresql.org': 'throw' }),
      await runCommand(contractWith(), {}),
      await runCommand(contractWith(clauseFor([
        { source: 'web', capabilities: ['read_item', 'search'], hosts: ['*.python.org', 'www.postgresql.org'] },
        { source: 'github', capabilities: ['read_item'], hosts: ['api.github.com'] },
      ])), { 'www.postgresql.org': 429, 'api.github.com': 200 }),
    ];
    for (const outcome of outcomes) {
      for (const line of [...outcome.out, ...outcome.err]) {
        expect(evidencePattern.test(line), line).toBe(true);
      }
    }
  });

  it('the workflow’s claim grammar matches the claim, and only the claim', async () => {
    const result = await runCommand(contractWith(POSTGRES), { 'www.postgresql.org': 200 });
    expect(result.out.filter((line) => claimPattern.test(line))).toEqual(claimOf(result.out));
    expect(claimOf(result.out)).toHaveLength(1);
  });
});

/* ------------------------------------------------ the bundle, as the workflow runs it */

/**
 * THE REAL ENTRYPOINT, BUNDLED THE WAY `relay:julius:build` BUNDLES IT.
 *
 * The in-process cases prove the function; these prove `main` routes to it and
 * that `run` still refuses exactly as it did. Only contracts with no research
 * clause reach the child, so nothing here can make a request.
 */
describe('the bundled entrypoint routes observe-research, and leaves run as it was', () => {
  let entry = '';
  let dir = '';
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'julius-observe-bundle-'));
    entry = join(dir, 'entry.cjs');
    const { build } = await import('esbuild');
    await build({
      entryPoints: [resolve(process.cwd(), 'relay-bridge/julius-live-mission.ts')],
      bundle: true, platform: 'node', format: 'cjs', outfile: entry,
      external: ['@anthropic-ai/claude-agent-sdk', 'pg'], logLevel: 'warning',
    });
  }, 60_000);

  const spawn = (args: readonly string[]): { code: number; stdout: string } => {
    try {
      const stdout = execFileSync(process.execPath, [entry, ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', NODE_PATH: resolve(process.cwd(), 'node_modules') },
      });
      return { code: 0, stdout };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      return { code: failure.status ?? 1, stdout: String(failure.stdout ?? '') };
    }
  };

  it('observe-research on a contract with no research clause exits 0 and exports nothing', () => {
    const contract = join(dir, 'no-research.json');
    writeFileSync(contract, contractWith());
    const result = spawn(['observe-research', '--contract', contract]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${RESEARCH_NOT_GRANTED_LINE}\n`);
  }, 30_000);

  it('observe-research without --contract is a usage refusal', () => {
    const result = spawn(['observe-research']);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('observe-research --contract');
  }, 30_000);

  it('run, and anything that is not a command, still gets the original usage line byte for byte', () => {
    for (const args of [['run'], ['observe'], [], ['run-observe-research', '--contract', 'x']]) {
      const result = spawn(args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stdout, args.join(' ')).toBe('Usage: julius-live-mission run --contract <mission.json> [--confirm-live] [--max-ticks N]\n');
    }
  }, 30_000);
});
