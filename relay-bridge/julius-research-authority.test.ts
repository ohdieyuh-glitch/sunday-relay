import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  observedResearchBackends,
  parseLiveMissionContract,
  researchReachSummary,
  sealLiveMissionResearchPolicy,
  type LiveMissionResearchClause,
} from './julius-live-mission';
import {
  authorizeJuliusResearch,
  emptyJuliusResearchLedger,
  juliusResearchPolicyIntact,
  noJuliusResearch,
  type JuliusResearchRequest,
} from '../src/relay/mission/julius';

/**
 * RESEARCH AUTHORITY, FROM THE MISSION DOCUMENT TO THE RUNTIME.
 *
 * The governed-research machinery has existed for several landings: a sealed
 * per-mission policy, a mediator, Live Reach, a durable retrieval ledger. What
 * did not exist was any way for a mission to be granted research at all — the
 * seam reached `assembleLiveJuliusRuntime` and stopped, so every paid mission
 * so far has run under `noJuliusResearch` whatever it said it wanted. These
 * cases are about the two things that were missing, and about the one that
 * must NOT appear with them.
 *
 * THREE SEPARATE FACTS, and the point of most of what follows is that they
 * stay separate:
 *
 *   1. what a mission is AUTHORISED to read  — the contract's research clause,
 *      bounded by a deployment grant a contract cannot write for itself;
 *   2. what an operator has OBSERVED a backend serve — the environment, never
 *      the contract, because a mission asserting its own reachability is
 *      vouching for the one thing it is not in a position to know;
 *   3. whether Relay will actually retrieve anything — decided at request time
 *      by the mediator from (1) and (2) together, and refused by default.
 *
 * Collapsing any two of them is how an allowlist becomes decorative.
 */

/* ------------------------------------------------------------- fixtures */

const CONTRACT_BASE = Object.freeze({
  missionId: 'mission:research-proof',
  markerNamespace: 'julius-research-proof',
  projectId: 'prj-research-proof',
  tenantId: 'tenant',
  objective: 'Prove the research seam.',
  testCommand: 'npm test',
  workspacePath: '/tmp/research-proof-workspace',
  acceptanceCriteria: [{ id: 'c1', text: 'It holds.', blocking: true }],
  limits: { spendUsd: 1, repairCycles: 0 },
});

const WELL_FORMED: LiveMissionResearchClause = Object.freeze({
  roles: ['PROMPT_ARCHITECT'],
  allowances: [{
    source: 'web',
    capabilities: ['read_item'],
    hosts: ['docs.python.org'],
  }],
  missionBudget: { maxRetrievals: 6, maxBytes: 400_000 },
  roleBudget: { maxRetrievals: 3, maxBytes: 200_000 },
});

const contractWith = (research?: unknown): string =>
  JSON.stringify(research === undefined ? CONTRACT_BASE : { ...CONTRACT_BASE, research });

const requestFor = (over: Partial<JuliusResearchRequest> = {}): JuliusResearchRequest => ({
  missionId: CONTRACT_BASE.missionId,
  projectId: CONTRACT_BASE.projectId,
  runId: 'run-1',
  taskId: 'task-1',
  role: 'PROMPT_ARCHITECT',
  source: 'web',
  capability: 'read_item',
  reference: 'https://docs.python.org/3/library/asyncio.html',
  purpose: 'Confirm the buffering boundary before planning.',
  requestedAt: '2026-09-11T00:00:00.000Z',
  ...over,
});

/* ============================================================ §A the clause */

describe('A — the mission contract carries research authority, or it carries none', () => {
  it('1. a contract with no research clause parses, and asks for nothing', () => {
    const parsed = parseLiveMissionContract(contractWith());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // UNDEFINED, not an empty policy. The entrypoint passes no
    // `researchPolicyFor` at all in this case, so the composition's own
    // `noJuliusResearch` applies and nothing has to remember to be empty.
    expect(parsed.contract.research).toBeUndefined();
    expect(Object.hasOwn(parsed.contract, 'research')).toBe(false);
  });

  it('2. a well-formed clause is carried through verbatim', () => {
    const parsed = parseLiveMissionContract(contractWith(WELL_FORMED));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.contract.research).toEqual(WELL_FORMED);
  });

  /**
   * SEALED AT PARSE TIME, with the DOMAIN'S reason code and not a paraphrase.
   *
   * Each row is a mistake a mission document can make. All of them stop the
   * contract before anything is submitted and before any provider is
   * contacted; a clause first sealed at dispatch would be a contract that
   * looked valid right up until it had already been paid for.
   */
  const refusals: readonly (readonly [string, unknown, string])[] = [
    ['an unknown source', { ...WELL_FORMED, allowances: [{ source: 'usenet', capabilities: ['read_item'], hosts: ['docs.python.org'] }] }, 'research_policy_source_unknown'],
    ['an action capability', { ...WELL_FORMED, allowances: [{ source: 'web', capabilities: ['post'], hosts: ['docs.python.org'] }] }, 'research_policy_action_capability'],
    ['an unknown capability', { ...WELL_FORMED, allowances: [{ source: 'web', capabilities: ['read_everything'], hosts: ['docs.python.org'] }] }, 'research_policy_capability_unknown'],
    ['no capability at all', { ...WELL_FORMED, allowances: [{ source: 'web', capabilities: [], hosts: ['docs.python.org'] }] }, 'research_policy_capability_required'],
    ['no host at all', { ...WELL_FORMED, allowances: [{ source: 'web', capabilities: ['read_item'], hosts: [] }] }, 'research_policy_host_required'],
    ['the whole internet', { ...WELL_FORMED, allowances: [{ source: 'web', capabilities: ['read_item'], hosts: ['*'] }] }, 'research_policy_host_too_broad'],
    ['a whole top-level domain', { ...WELL_FORMED, allowances: [{ source: 'web', capabilities: ['read_item'], hosts: ['*.com'] }] }, 'research_policy_host_too_broad'],
    ['a URL in a host slot', { ...WELL_FORMED, allowances: [{ source: 'web', capabilities: ['read_item'], hosts: ['https://docs.python.org/3'] }] }, 'research_policy_host_not_a_name'],
    ['a duplicated source', { ...WELL_FORMED, allowances: [WELL_FORMED.allowances[0], WELL_FORMED.allowances[0]] }, 'research_policy_source_duplicated'],
    ['an unknown role', { ...WELL_FORMED, roles: ['FOUNDER'] }, 'research_policy_role_unknown'],
    ['a negative budget', { ...WELL_FORMED, missionBudget: { maxRetrievals: -1, maxBytes: null } }, 'research_policy_budget_invalid'],
    ['a fractional budget', { ...WELL_FORMED, roleBudget: { maxRetrievals: 1.5, maxBytes: null } }, 'research_policy_budget_invalid'],
  ];

  for (const [what, clause, reasonCode] of refusals) {
    it(`3. the contract is refused for ${what}, naming ${reasonCode}`, () => {
      const parsed = parseLiveMissionContract(contractWith(clause));
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.problem).toContain(reasonCode);
    });
  }

  it('4. a research field that is not an object is refused', () => {
    for (const bad of [null, [], 'web', 7]) {
      const parsed = parseLiveMissionContract(contractWith(bad));
      expect(parsed.ok, `research: ${JSON.stringify(bad)}`).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.problem).toContain('"research" must be an object');
    }
  });

  it('5. the sealed policy is bound to the CONTRACT\'s mission, not one the clause picks', () => {
    const sealed = sealLiveMissionResearchPolicy(CONTRACT_BASE.missionId, {
      ...WELL_FORMED,
      // A clause cannot name its own mission: there is no field for it, and
      // the entrypoint supplies the contract's id at the one call site.
    } as LiveMissionResearchClause);
    expect(sealed.missionId).toBe(CONTRACT_BASE.missionId);
  });

  it('6. the sealed policy is intact, and two spellings of one clause seal identically', () => {
    const sealed = sealLiveMissionResearchPolicy(CONTRACT_BASE.missionId, WELL_FORMED);
    expect(juliusResearchPolicyIntact(sealed)).toBe(true);

    const reordered = sealLiveMissionResearchPolicy(CONTRACT_BASE.missionId, {
      ...WELL_FORMED,
      allowances: [{
        source: 'web',
        capabilities: ['read_item'],
        // Same host, shouted, with a trailing root dot.
        hosts: ['DOCS.PYTHON.ORG.'],
      }],
    });
    expect(reordered.fingerprint).toBe(sealed.fingerprint);
  });

  it('7. the sealed policy authorises exactly what the clause said, and nothing adjacent', () => {
    const policy = sealLiveMissionResearchPolicy(CONTRACT_BASE.missionId, WELL_FORMED);
    const ledger = emptyJuliusResearchLedger(CONTRACT_BASE.missionId);
    const decide = (over: Partial<JuliusResearchRequest>) =>
      authorizeJuliusResearch({ request: requestFor(over), policy, ledger });

    expect(decide({}).ok).toBe(true);

    // A host the clause did not name, however plausible.
    const neighbour = decide({ reference: 'https://docs.python.com/3/library/asyncio.html' });
    expect(neighbour.ok).toBe(false);

    // A slot the clause did not authorise, refused by name rather than by budget.
    const otherRole = decide({ role: 'CODING_AGENT' });
    expect(otherRole.ok).toBe(false);
    if (!otherRole.ok) expect(otherRole.outcome).toBe('policy_refused');

    // A capability the clause did not grant on a source it did.
    const otherCapability = decide({ capability: 'search' });
    expect(otherCapability.ok).toBe(false);
  });

  it('8. the default is not an empty policy that happens to allow nothing — it refuses by name', () => {
    const policy = noJuliusResearch(CONTRACT_BASE.missionId);
    const decision = authorizeJuliusResearch({
      request: requestFor(),
      policy,
      ledger: emptyJuliusResearchLedger(CONTRACT_BASE.missionId),
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.outcome).toBe('policy_refused');
  });
});

/* ==================================================== §B the observations */

describe('B — what an operator has observed, checked against the real registry', () => {
  const read = (value: string | undefined) =>
    observedResearchBackends(value === undefined ? {} : { JULIUS_RESEARCH_OBSERVED_BACKENDS: value });

  it('9. absent or empty means no observation, which is the honest default', () => {
    for (const value of [undefined, '', '   ']) {
      const result = read(value);
      expect(result.ok, JSON.stringify(value)).toBe(true);
      if (!result.ok) continue;
      expect(result.probes).toEqual([]);
    }
  });

  it('10. a well-formed claim becomes an observed probe', () => {
    const result = read('relay_http_fetch:read_item');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.probes).toHaveLength(1);
    expect(result.probes[0].backendId).toBe('relay_http_fetch');
    expect(result.probes[0].capability).toBe('read_item');
    expect(result.probes[0].result).toBe('observed');
  });

  it('11. probedAt is null, because nothing was probed here', () => {
    const result = read(' relay_http_fetch : read_item ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // UNKNOWN IS NOT NOW. The operator asserts they have seen it; stamping the
    // current instant would date an observation nobody made in this process.
    expect(result.probes[0].probedAt).toBeNull();
  });

  const rejected: readonly (readonly [string, string, string])[] = [
    ['no capability', 'relay_http_fetch', 'research_observation_malformed'],
    ['three parts', 'relay_http_fetch:read_item:extra', 'research_observation_malformed'],
    ['an empty half', ':read_item', 'research_observation_malformed'],
    ['an action', 'relay_http_fetch:post', 'research_observation_action_capability'],
    ['a typo', 'relay_http_fetch:read_iten', 'research_observation_capability_unknown'],
    ['a backend nobody has', 'relay_magic_fetch:read_item', 'research_observation_backend_unknown'],
    ['a backend that cannot do it', 'relay_http_fetch:read_profile', 'research_observation_backend_cannot'],
    ['the same claim twice', 'relay_http_fetch:read_item,relay_http_fetch:read_item', 'research_observation_duplicated'],
  ];

  for (const [what, value, reasonCode] of rejected) {
    it(`12. ${what} refuses the run, naming ${reasonCode}`, () => {
      const result = read(value);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem).toContain(reasonCode);
    });
  }

  it('13. a bad claim refuses the WHOLE list — there is no partial observation', () => {
    const result = read('relay_http_fetch:read_item,relay_magic_fetch:read_item');
    expect(result.ok).toBe(false);
    // The alternative — dropping the bad entry and keeping the good one — is
    // how an operator ends up believing they armed two backends and running
    // with one. `resolveReadiness` would consult the survivor and say nothing
    // about the claim that silently vanished.
  });

  it('14. a claim the registry cannot serve is refused rather than left inert', () => {
    // `resolveReadiness` only consults a probe whose backendId AND capability
    // both match a real candidate. An unmatched probe is not a weaker
    // observation, it is NO observation — the mission would run with research
    // silently refused while the operator believed it was armed. That is the
    // failure this refusal exists to make visible, before the money.
    const result = read('relay_http_fetch:read_profile');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toContain('does not implement');
  });
});

/* ======================================================== §C what it reaches */

describe('C — reach is reported before the run, and never enforced there', () => {
  const probes = (value: string) => {
    const result = observedResearchBackends({ JULIUS_RESEARCH_OBSERVED_BACKENDS: value });
    if (!result.ok) throw new Error(result.problem);
    return result.probes;
  };

  it('15. an authorised pair with an observed backend reads as ready', () => {
    const rows = researchReachSummary(WELL_FORMED, probes('relay_http_fetch:read_item'));
    expect(rows).toEqual([{ source: 'web', capability: 'read_item', readiness: 'ready' }]);
  });

  it('16. an authorised pair with no observation is NOT ready, and says which', () => {
    const rows = researchReachSummary(WELL_FORMED, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].readiness).not.toBe('ready');
  });

  it('17. every authorised (source, capability) pair is reported, not just the first', () => {
    const clause: LiveMissionResearchClause = {
      ...WELL_FORMED,
      allowances: [
        { source: 'web', capabilities: ['read_item', 'read_feed'], hosts: ['docs.python.org'] },
        { source: 'github', capabilities: ['read_item'], hosts: ['api.github.com'] },
      ],
    };
    const rows = researchReachSummary(clause, []);
    expect(rows.map((row) => `${row.source}/${row.capability}`).sort())
      .toEqual(['github/read_item', 'web/read_feed', 'web/read_item']);
  });

  it('18. reporting reach does not widen what the mission may read', () => {
    // A pair can be `ready` and still refused: readiness is about Relay, the
    // allowlist is about this mission, and the mediator asks both.
    const policy = sealLiveMissionResearchPolicy(CONTRACT_BASE.missionId, WELL_FORMED);
    const ready = researchReachSummary(WELL_FORMED, probes('relay_http_fetch:read_item'));
    expect(ready[0].readiness).toBe('ready');
    const decision = authorizeJuliusResearch({
      request: requestFor({ reference: 'https://example.org/anything' }),
      policy,
      ledger: emptyJuliusResearchLedger(CONTRACT_BASE.missionId),
    });
    expect(decision.ok).toBe(false);
  });
});

/* ========================================================== §D the wire */

describe('D — the entrypoint actually hands both halves to the runtime', () => {
  const ENTRY = readFileSync(join(process.cwd(), 'relay-bridge/julius-live-mission.ts'), 'utf8');

  /** The body of a call, matched by counting braces rather than by a lazy regex. */
  const callBody = (source: string, callee: string): string => {
    const open = source.indexOf(`${callee}({`);
    expect(open, `${callee}( not found`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let index = open + callee.length + 1; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(open, index + 1);
      }
    }
    throw new Error(`unbalanced ${callee}(`);
  };

  it('19. assembleLiveJuliusRuntime is given researchPolicyFor and researchProbes', () => {
    // BLOCKER 5's residue: before this, the composition accepted both options
    // and the entrypoint passed neither, so governed research was unreachable
    // in production however well it was proven in a test.
    const body = callBody(ENTRY, 'assembleLiveJuliusRuntime');
    expect(body).toContain('researchPolicyFor:');
    expect(body).toContain('researchProbes:');
  });

  it('20. both sit behind the clause, so an absent clause passes neither', () => {
    const body = callBody(ENTRY, 'assembleLiveJuliusRuntime');
    const guard = body.indexOf('researchClause === undefined ? {} : {');
    expect(guard, 'the research options are not behind the clause guard').toBeGreaterThanOrEqual(0);
    expect(body.indexOf('researchPolicyFor:')).toBeGreaterThan(guard);
    expect(body.indexOf('researchProbes:')).toBeGreaterThan(guard);
  });

  it('21. the entrypoint never invents an observation from the contract', () => {
    // The contract states authority. If it could also state what Relay has
    // seen, a mission document would be vouching for the one fact it cannot
    // know, and Live Reach's readiness gate would become decorative.
    const clause = ENTRY.slice(ENTRY.indexOf('export interface LiveMissionResearchClause'));
    const body = clause.slice(0, clause.indexOf('}'));
    expect(body).not.toContain('probe');
    expect(body).not.toContain('backend');
    expect(body).not.toContain('observed');
  });

  it('22. a mistyped observation refuses before anything is submitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-research-'));
    const contractPath = join(dir, 'contract.json');
    writeFileSync(contractPath, contractWith());
    execFileSync('npx', ['--no-install', 'esbuild', 'relay-bridge/julius-live-mission.ts',
      '--bundle', '--platform=node', '--format=cjs',
      `--outfile=${join(dir, 'entry.cjs')}`,
      '--external:@anthropic-ai/claude-agent-sdk', '--external:pg', '--log-level=warning'],
      { cwd: process.cwd(), stdio: 'pipe' });

    let output = '';
    try {
      output = execFileSync('node', [join(dir, 'entry.cjs'), 'run', '--contract', contractPath], {
        cwd: process.cwd(),
        // Deliberately a machine with nothing else configured: no database, no
        // executor, no credential. The observation refusal must come first
        // anyway, because after `bootstrap.submit` there is a durable run to
        // reconcile and refusing then would leave one behind for a typo.
        env: {
          PATH: process.env.PATH ?? '',
          // The bundle keeps `pg` external, so the child needs somewhere to
          // find it; everything else is deliberately absent.
          NODE_PATH: join(process.cwd(), 'node_modules'),
          JULIUS_RESEARCH_OBSERVED_BACKENDS: 'relay_http_fetch:read_iten',
        },
        encoding: 'utf8',
      });
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? '');
    }
    expect(output).toContain('research_observation_capability_unknown');
    expect(output).toContain('nothing was submitted and no provider was contacted');
    // AND IT STOPPED THERE. This machine has no database, no executor and no
    // credential, so it would have been refused a few lines later anyway —
    // which is precisely why the generic refusal is not enough evidence. The
    // preflight banner is printed unconditionally once the observation check
    // is passed, so its ABSENCE is what proves the refusal came first.
    expect(output).not.toContain('JULIUS LIVE MISSION — preflight');
  }, 120_000);
});

/* ================================================ §E the deployment grant */

describe('E — a contract may ask for research; it may not grant itself research', () => {
  const CHECK = 'scripts/julius-live-contract-check.mjs';
  const runCheck = (contract: unknown): { code: number; output: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-grant-'));
    const path = join(dir, 'contract.json');
    writeFileSync(path, JSON.stringify(contract));
    try {
      const output = execFileSync('node', [CHECK, path], { cwd: process.cwd(), encoding: 'utf8' });
      return { code: 0, output };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  };

  it('23. a contract with no research clause passes exactly as before', () => {
    const result = runCheck(CONTRACT_BASE);
    expect(result.code).toBe(0);
    expect(result.output).toContain('research: NONE');
  });

  it('24. a contract that declares research is refused: no grant exists for it', () => {
    const result = runCheck({ ...CONTRACT_BASE, research: WELL_FORMED });
    expect(result.code).toBe(1);
    expect(result.output).toContain('a contract cannot grant itself research authority');
  });

  /**
   * 25. THE TRIPWIRE, ARMED RATHER THAN REMOVED.
   *
   * This case used to assert the grant table was EMPTY, and said in its comment
   * that a failure would mean someone granted research — which is allowed, and
   * is exactly the moment a human should look. Someone did: the first
   * continuous qualification. So the case now names WHO, and fires again on the
   * second grant for the same reason it fired on the first.
   */
  const GRANTED: readonly string[] = ['julius-continuous-1', 'julius-live-mission-6'];

  it('25. exactly the missions named here are granted research, and no others', () => {
    const source = readFileSync(join(process.cwd(), CHECK), 'utf8');
    const table = source.slice(source.indexOf('const MISSION_RESEARCH = Object.freeze({'));
    const body = table.slice(table.indexOf('{'), table.indexOf('\n});') + 1);
    const keys = [...body.matchAll(/^ {2}'([a-z0-9-]+)':/gmu)].map((match) => match[1]);
    expect(keys, 'granting a mission research is a deliberate, reviewable edit — name it here').toEqual([...GRANTED]);
  });

  /**
   * 26. A GRANT AND A CLAUSE ARE TWO HALVES AND BOTH MUST EXIST.
   *
   * A contract declaring research with no grant is refused by the checker
   * (case 24). The other direction has no gate: a grant naming a mission whose
   * contract asks for nothing is standing authority nobody reads, which is
   * worse than none because it survives review by being invisible.
   */
  it('26. every granted mission asks for research, and every mission that asks is granted', () => {
    const root = join(process.cwd(), '.github/julius-missions');
    const namespaces = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(namespaces.length).toBeGreaterThan(0);
    const asking: string[] = [];
    for (const namespace of namespaces) {
      const path = join(root, namespace.name, 'contract.json');
      let raw: string;
      try { raw = readFileSync(path, 'utf8'); } catch { continue; }
      const contract = JSON.parse(raw) as Record<string, unknown>;
      if (contract.research !== undefined) asking.push(namespace.name);
    }
    expect(asking.sort(), 'a clause with no grant, or a grant with no clause').toEqual([...GRANTED].sort());
  });

  /**
   * 27. A GRANT MAY NOT NAME A SLOT THAT CANNOT ASK.
   *
   * The property has not changed; the set of slots that can ask has. This case
   * read `['CODING_AGENT']` for as long as the Coding Agent was the only slot
   * with a channel to Julius — the architect and the reviewer answered with
   * fixed schemas and had nowhere to put a request. Both now carry
   * `researchAsks` as a REQUIRED schema field and ask on every turn, so a
   * grant naming them describes authority a run can really spend, and a grant
   * WITHHOLDING it refuses an ask the schema compels the worker to make.
   *
   * NAMED, NOT DERIVED — for the same reason `GRANTED` above is. Deriving this
   * from the role enum would make it pass automatically for a fourth slot that
   * has no channel yet, which is precisely the divergence this case exists to
   * catch. Widening it stays a deliberate, reviewable edit.
   */
  const ASKING_SLOTS: readonly string[] = ['CODING_AGENT', 'INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT'];

  it('27. every granted role is one that can actually make an ask', () => {
    const source = readFileSync(join(process.cwd(), CHECK), 'utf8');
    const table = source.slice(source.indexOf('const MISSION_RESEARCH = Object.freeze({'));
    const body = table.slice(table.indexOf('{'), table.indexOf('\n});') + 1);
    const roles = [...body.matchAll(/roles: Object\.freeze\(\[([^\]]*)\]\)/gu)]
      .flatMap((match) => [...match[1]!.matchAll(/'([A-Z_]+)'/gu)].map((role) => role[1]));
    expect(roles.length, 'at least one grant states its roles').toBeGreaterThan(0);
    for (const role of [...new Set(roles)].sort()) {
      expect(ASKING_SLOTS, `${role} is granted research but has no channel to ask`).toContain(role);
    }
  });
});
