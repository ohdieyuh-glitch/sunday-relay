import { describe, expect, it } from 'vitest';
import {
  JULIUS_RESEARCH_OUTCOMES,
  JULIUS_RESEARCH_ROLES,
  authorizeJuliusResearch,
  emptyJuliusResearchLedger,
  juliusMissionResearchMeter,
  juliusResearchHostMatches,
  juliusResearchMayCorroborate,
  juliusResearchPolicyIntact,
  juliusResearchProducedEvidence,
  juliusResearchRequestedHost,
  noJuliusResearch,
  recordJuliusResearch,
  sealJuliusResearchPolicy,
  type JuliusResearchPolicy,
  type JuliusResearchRequest,
  type JuliusResearchRole,
} from './julius-research-policy';

/**
 * ADVERSARIAL BY CONSTRUCTION.
 *
 * Every test below is an attempt to get at something the mission did not
 * authorize — through the allowlist, through the wildcard, through the scheme,
 * through the budget, through another slot's allowance, or by handing the
 * authorizer a policy nobody sealed. A suite that only demonstrated the happy
 * path would prove the module runs, not that it holds.
 */

const AT = '2026-09-11T10:00:00.000Z';

const policy = (): JuliusResearchPolicy => sealJuliusResearchPolicy({
  missionId: 'mission-1',
  roles: [...JULIUS_RESEARCH_ROLES],
  allowances: [
    { source: 'web', capabilities: ['read_item', 'search'], hosts: ['*.python.org', 'nodejs.org'] },
    { source: 'github', capabilities: ['read_item'], hosts: ['api.github.com'] },
  ],
  missionBudget: { maxRetrievals: 30, maxBytes: null },
  roleBudget: { maxRetrievals: 10, maxBytes: null },
});

const request = (over: Partial<JuliusResearchRequest> = {}): JuliusResearchRequest => ({
  missionId: 'mission-1',
  projectId: 'prj-1',
  runId: 'run-1',
  taskId: 'task-1',
  role: 'CODING_AGENT',
  source: 'web',
  capability: 'read_item',
  reference: 'https://docs.python.org/3/library/asyncio.html',
  purpose: 'Whether asyncio.timeout exists in the pinned interpreter.',
  requestedAt: AT,
  ...over,
});

describe('the vocabularies are closed', () => {
  it('names all eight research outcomes and never a ninth', () => {
    expect([...JULIUS_RESEARCH_OUTCOMES]).toEqual([
      'observed', 'injection_signaled', 'policy_refused', 'budget_exhausted',
      'unreachable', 'unauthenticated', 'throttled', 'unsupported_content',
    ]);
  });

  it('treats the three slots as peers, with no fourth and no ranking', () => {
    expect([...JULIUS_RESEARCH_ROLES]).toEqual([
      'PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER',
    ]);
  });

  it('keeps a signalled observation as evidence, but never as corroboration', () => {
    // It is not a failure. The content was retrieved and is kept — the whole
    // point of recording it is that a Reviewer can see hostile text was there.
    expect(juliusResearchProducedEvidence('injection_signaled')).toBe(true);
    expect(juliusResearchProducedEvidence('observed')).toBe(true);
    expect(juliusResearchProducedEvidence('unreachable')).toBe(false);
    // But the cheapest attack on a corroboration rule is publishing the
    // corroboration, so it may not be the thing that tips a disagreement.
    expect(juliusResearchMayCorroborate('injection_signaled')).toBe(false);
    expect(juliusResearchMayCorroborate('observed')).toBe(true);
  });
});

describe('a policy that claims too much is refused where it is written', () => {
  it('refuses an action capability outright — research is looking, not acting', () => {
    expect(() => sealJuliusResearchPolicy({
      missionId: 'mission-1',
      roles: ['CODING_AGENT'],
      allowances: [{ source: 'x', capabilities: ['post' as never], hosts: ['x.com'] }],
      missionBudget: { maxRetrievals: 1, maxBytes: null },
      roleBudget: { maxRetrievals: 1, maxBytes: null },
    })).toThrow('research_policy_action_capability');
  });

  it.each([
    ['*', 'research_policy_host_too_broad'],
    ['*.com', 'research_policy_host_too_broad'],
    ['*.org', 'research_policy_host_too_broad'],
    ['https://python.org', 'research_policy_host_not_a_name'],
    ['python.org/3/library', 'research_policy_host_not_a_name'],
    ['user@python.org', 'research_policy_host_not_a_name'],
    ['python.org:8443', 'research_policy_host_not_a_name'],
    ['93.184.216.34', 'research_policy_host_not_a_name'],
    ['localhost', 'research_policy_host_not_a_name'],
  ])('refuses %s as an allowlist entry', (host, reason) => {
    expect(() => sealJuliusResearchPolicy({
      missionId: 'mission-1',
      roles: ['CODING_AGENT'],
      allowances: [{ source: 'web', capabilities: ['read_item'], hosts: [host] }],
      missionBudget: { maxRetrievals: 1, maxBytes: null },
      roleBudget: { maxRetrievals: 1, maxBytes: null },
    })).toThrow(reason);
  });

  it('refuses an allowance with no host and one with no capability', () => {
    const base = {
      missionId: 'mission-1',
      roles: ['CODING_AGENT'] as readonly JuliusResearchRole[],
      missionBudget: { maxRetrievals: 1, maxBytes: null },
      roleBudget: { maxRetrievals: 1, maxBytes: null },
    };
    expect(() => sealJuliusResearchPolicy({
      ...base, allowances: [{ source: 'web', capabilities: ['read_item'], hosts: [] }],
    })).toThrow('research_policy_host_required');
    expect(() => sealJuliusResearchPolicy({
      ...base, allowances: [{ source: 'web', capabilities: [], hosts: ['python.org'] }],
    })).toThrow('research_policy_capability_required');
  });
});

describe('the wildcard does exactly what it says', () => {
  it.each([
    ['*.python.org', 'docs.python.org', true],
    ['*.python.org', 'a.b.python.org', true],
    ['*.python.org', 'PYTHON.ORG', false],
    ['*.python.org', 'python.org', false],
    ['*.python.org', 'evilpython.org', false],
    ['*.python.org', 'notpython.org', false],
    ['*.python.org', 'python.org.evil.com', false],
    ['*.python.org', 'docs.python.org.evil.com', false],
    ['nodejs.org', 'nodejs.org', true],
    ['nodejs.org', 'NODEJS.ORG.', true],
    ['nodejs.org', 'www.nodejs.org', false],
    ['nodejs.org', 'evilnodejs.org', false],
  ])('%s vs %s is %s', (pattern, host, expected) => {
    expect(juliusResearchHostMatches(pattern, host)).toBe(expected);
  });
});

describe('the host an ask reached for is recorded as a name and nothing else', () => {
  it.each([
    ['https://www.postgresql.org/docs/current/app-psql.html', 'www.postgresql.org'],
    ['https://WWW.PostgreSQL.org./docs?x=1#y', 'www.postgresql.org'],
    ['http://github.com/owner/repo', 'github.com'],
    ['https://user:pass@docs.python.org/3/', 'docs.python.org'],
    ['https://xn--bcher-kva.example/', 'xn--bcher-kva.example'],
    ['https://127.0.0.1/', null],
    ['https://[::1]/', null],
    ['https://localhost/', null],
    ['the psql manual', null],
    ['', null],
    [`https://${'a'.repeat(64)}.example/`, null],
  ] as const)('%s records %s', (reference, host) => {
    expect(juliusResearchRequestedHost(reference)).toBe(host);
  });

  it('is the host the policy compared, so a recorded refusal names what was refused', () => {
    const asked = request({ reference: 'https://Evil.Example./a/b?c' });
    const verdict = authorizeJuliusResearch({ request: asked, policy: policy(), ledger: emptyJuliusResearchLedger('mission-1') });
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.refusal).toBe('host_not_allowed');
    expect(!verdict.ok && verdict.detail).toContain(`${juliusResearchRequestedHost(asked.reference)!} is not on`);
  });
});

describe('the allowlist is mission authority', () => {
  it('is frozen, so nothing in the request path can append to it', () => {
    const sealed = policy();
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.allowances)).toBe(true);
    expect(Object.isFrozen(sealed.allowances[0]!.hosts)).toBe(true);
    expect(() => {
      (sealed.allowances[0]!.hosts as string[]).push('evil.example');
    }).toThrow(TypeError);
  });

  it('detects a policy rebuilt with an extra host, and refuses to decide under it', () => {
    // The attack this closes: something reconstructs the object with a wider
    // allowlist and the original fingerprint, then hands it to the authorizer.
    const sealed = policy();
    const widened = {
      ...sealed,
      allowances: [
        { source: 'web' as const, capabilities: ['read_item' as const], hosts: ['*.python.org', 'evil.example'] },
        ...sealed.allowances.slice(1),
      ],
    };
    expect(juliusResearchPolicyIntact(sealed)).toBe(true);
    expect(juliusResearchPolicyIntact(widened)).toBe(false);

    const verdict = authorizeJuliusResearch({
      request: request({ reference: 'https://evil.example/x' }),
      policy: widened,
      ledger: emptyJuliusResearchLedger('mission-1'),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('policy_tampered');
  });

  it('refuses a policy sealed for a different mission', () => {
    const verdict = authorizeJuliusResearch({
      request: request({ missionId: 'mission-2' }),
      policy: policy(),
      ledger: emptyJuliusResearchLedger('mission-2'),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('policy_tampered');
  });

  it('ignores anything extra a caller hangs off the request', () => {
    // There is no widening field on the request type. Inventing one at runtime
    // must change nothing — the authorizer reads only the sealed policy.
    const hostile = {
      ...request({ reference: 'https://evil.example/x' }),
      allowHosts: ['evil.example'],
      policy: { allowances: [{ source: 'web', capabilities: ['read_item'], hosts: ['*'] }] },
      roleBudget: { maxRetrievals: 9999, maxBytes: null },
    } as unknown as JuliusResearchRequest;
    const verdict = authorizeJuliusResearch({
      request: hostile, policy: policy(), ledger: emptyJuliusResearchLedger('mission-1'),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('host_not_allowed');
  });

  it('authorizes no research at all by default, and says so by name', () => {
    const verdict = authorizeJuliusResearch({
      request: request(),
      policy: noJuliusResearch('mission-1'),
      ledger: emptyJuliusResearchLedger('mission-1'),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('research_not_authorized');
  });
});

describe('a request is checked against every dimension the mission named', () => {
  it('permits exactly what the mission allowed, and records what permitted it', () => {
    const verdict = authorizeJuliusResearch({
      request: request(), policy: policy(), ledger: emptyJuliusResearchLedger('mission-1'),
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error(verdict.detail);
    expect(verdict.host).toBe('docs.python.org');
    expect(verdict.matchedHost).toBe('*.python.org');
    expect(verdict.policyFingerprint).toBe(policy().fingerprint);
  });

  it.each([
    ['http://docs.python.org/x', 'scheme_not_allowed'],
    ['file:///etc/passwd', 'scheme_not_allowed'],
    ['ftp://docs.python.org/x', 'scheme_not_allowed'],
    ['docs.python.org/x', 'reference_unparsable'],
    ['https://user:pass@docs.python.org/x', 'reference_unparsable'],
    ['https://api.github.com/x', 'host_not_allowed'],
    ['https://evil.example/x', 'host_not_allowed'],
  ])('refuses %s', (reference, refusal) => {
    const verdict = authorizeJuliusResearch({
      request: request({ reference }), policy: policy(), ledger: emptyJuliusResearchLedger('mission-1'),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe(refusal);
    expect(verdict.outcome).toBe('policy_refused');
  });

  it('refuses a source and a capability the mission did not name', () => {
    const unnamedSource = authorizeJuliusResearch({
      request: request({ source: 'reddit', reference: 'https://docs.python.org/x' }),
      policy: policy(), ledger: emptyJuliusResearchLedger('mission-1'),
    });
    expect(unnamedSource.ok).toBe(false);
    if (unnamedSource.ok) throw new Error('unreachable');
    expect(unnamedSource.refusal).toBe('source_not_allowed');

    const unnamedCapability = authorizeJuliusResearch({
      request: request({ source: 'github', capability: 'read_comments', reference: 'https://api.github.com/x' }),
      policy: policy(), ledger: emptyJuliusResearchLedger('mission-1'),
    });
    expect(unnamedCapability.ok).toBe(false);
    if (unnamedCapability.ok) throw new Error('unreachable');
    expect(unnamedCapability.refusal).toBe('capability_not_allowed');
  });

  it('refuses a slot the mission left out, by name', () => {
    const narrowed = sealJuliusResearchPolicy({
      missionId: 'mission-1',
      roles: ['PROMPT_ARCHITECT'],
      allowances: [{ source: 'web', capabilities: ['read_item'], hosts: ['*.python.org'] }],
      missionBudget: { maxRetrievals: 5, maxBytes: null },
      roleBudget: { maxRetrievals: 5, maxBytes: null },
    });
    const verdict = authorizeJuliusResearch({
      request: request({ role: 'INDEPENDENT_REVIEWER' }),
      policy: narrowed, ledger: emptyJuliusResearchLedger('mission-1'),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('role_not_authorized');
    expect(verdict.detail).toContain('INDEPENDENT_REVIEWER');
  });
});

describe('budget is decided last, and separately per slot', () => {
  const spend = (times: number, role: JuliusResearchRole) => {
    let ledger = emptyJuliusResearchLedger('mission-1');
    for (let i = 0; i < times; i += 1) {
      ledger = recordJuliusResearch(ledger, role, {
        source: 'web', outcome: 'observed', bytes: 100, at: AT,
      });
    }
    return ledger;
  };

  it('never reports budget for a request policy would refuse anyway', () => {
    // "Budget exhausted" reads as "try later". A request that will never be
    // permitted must not be given that reading, or the worker waits instead of
    // asking the mission.
    const verdict = authorizeJuliusResearch({
      request: request({ reference: 'https://evil.example/x' }),
      policy: policy(),
      ledger: spend(10, 'CODING_AGENT'),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('host_not_allowed');
  });

  it('exhausts one slot without touching the other two', () => {
    const ledger = spend(10, 'CODING_AGENT');
    const coder = authorizeJuliusResearch({ request: request(), policy: policy(), ledger });
    expect(coder.ok).toBe(false);
    if (coder.ok) throw new Error('unreachable');
    expect(coder.refusal).toBe('role_budget_exhausted');
    expect(coder.outcome).toBe('budget_exhausted');
    expect(coder.detail).toContain('CODING_AGENT');

    for (const role of ['PROMPT_ARCHITECT', 'INDEPENDENT_REVIEWER'] as const) {
      const peer = authorizeJuliusResearch({ request: request({ role }), policy: policy(), ledger });
      expect(peer.ok, `${role} must keep its own allowance`).toBe(true);
    }
  });

  it('reports the mission ceiling as the mission ceiling, not as a slot one', () => {
    const tight = sealJuliusResearchPolicy({
      missionId: 'mission-1',
      roles: [...JULIUS_RESEARCH_ROLES],
      allowances: [{ source: 'web', capabilities: ['read_item'], hosts: ['*.python.org'] }],
      missionBudget: { maxRetrievals: 4, maxBytes: null },
      roleBudget: { maxRetrievals: 10, maxBytes: null },
    });
    let ledger = emptyJuliusResearchLedger('mission-1');
    for (const role of JULIUS_RESEARCH_ROLES) {
      ledger = recordJuliusResearch(ledger, role, { source: 'web', outcome: 'observed', bytes: 10, at: AT });
    }
    ledger = recordJuliusResearch(ledger, 'PROMPT_ARCHITECT', { source: 'web', outcome: 'observed', bytes: 10, at: AT });
    const verdict = authorizeJuliusResearch({ request: request(), policy: tight, ledger });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.refusal).toBe('mission_budget_exhausted');
  });

  it('charges an unreachable host, because Relay cannot prove it was free', () => {
    // The pessimistic direction is the only one that fails closed: a host that
    // never answers must not become an unlimited retry.
    const ledger = recordJuliusResearch(emptyJuliusResearchLedger('mission-1'), 'CODING_AGENT', {
      source: 'web', outcome: 'unreachable', bytes: null, at: AT,
    });
    expect(ledger.byRole.CODING_AGENT.unknownEffect).toBe(1);
    expect(ledger.byRole.CODING_AGENT.counted).toBe(0);
    expect(juliusMissionResearchMeter(ledger).unknownEffect).toBe(1);
  });

  it('spends nothing when it refuses', () => {
    const ledger = emptyJuliusResearchLedger('mission-1');
    authorizeJuliusResearch({ request: request({ reference: 'https://evil.example/x' }), policy: policy(), ledger });
    expect(juliusMissionResearchMeter(ledger).counted).toBe(0);
    expect(juliusMissionResearchMeter(ledger).unknownEffect).toBe(0);
  });
});

describe('the mission total is derived, never separately kept', () => {
  it('folds the three slots and keeps an unmeasured byte total unknown', () => {
    let ledger = emptyJuliusResearchLedger('mission-1');
    ledger = recordJuliusResearch(ledger, 'PROMPT_ARCHITECT', { source: 'web', outcome: 'observed', bytes: null, at: AT });
    ledger = recordJuliusResearch(ledger, 'INDEPENDENT_REVIEWER', { source: 'github', outcome: 'throttled', bytes: null, at: AT, retryAfter: '30' });
    const total = juliusMissionResearchMeter(ledger);

    // Nothing has been measured, so the sum is Unknown — not zero, which would
    // read as "nothing was read".
    expect(total.bytes).toBeNull();
    expect(total.counted).toBe(2);
    expect(total.unsized).toBe(2);
    expect(total.bySource).toEqual({
      web: { counted: 1, unknownEffect: 0 },
      github: { counted: 1, unknownEffect: 0 },
    });
    expect(total.lastRetryAfter).toBe('30');
  });

  it('keeps every slot\'s provenance apart rather than pooling it', () => {
    let ledger = emptyJuliusResearchLedger('mission-1');
    ledger = recordJuliusResearch(ledger, 'CODING_AGENT', { source: 'web', outcome: 'observed', bytes: 7, at: AT });
    expect(ledger.byRole.CODING_AGENT.counted).toBe(1);
    expect(ledger.byRole.PROMPT_ARCHITECT.counted).toBe(0);
    expect(ledger.byRole.INDEPENDENT_REVIEWER.counted).toBe(0);
    expect(juliusMissionResearchMeter(ledger).bytes).toBe(7);
  });
});
