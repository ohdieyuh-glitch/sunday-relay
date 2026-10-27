import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { acceptOrgAttributionLine, agreeWithGate, gateVerifiedOrganizations, readAnthropicOrgAttribution, readJ1OrgAttributions, type OrgProbeSpawn } from './anthropic-org-attribution';

describe('the live entry accepts only a closed organization-attribution line', () => {
  it('a verified line is the gate', () => {
    const line = 'org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=VERIFIED organization_id=org_recorded';
    expect(acceptOrgAttributionLine(`${line}\n`)).toEqual({ verified: true, line, organizationId: 'org_recorded' });
  });

  it('mismatch, a missing expected id, and a missing header are unverified and kept', () => {
    for (const line of [
      'org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=ORG_ATTRIBUTION_UNVERIFIED reason=mismatch organization_id=org_other expected_organization_id=org_recorded',
      'org_attribution provider=anthropic model=claude-opus-5-5 http=none result=ORG_ATTRIBUTION_UNVERIFIED reason=expected_unset',
      'org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=ORG_ATTRIBUTION_UNVERIFIED reason=header_missing',
      'org_attribution provider=anthropic model=claude-opus-5-5 http=none result=ORG_ATTRIBUTION_UNVERIFIED reason=api_key_missing',
    ]) {
      expect(acceptOrgAttributionLine(line).verified, line).toBe(false);
      expect(acceptOrgAttributionLine(line).line).toBe(line);
    }
  });

  it('a line that carries a key is not forwarded', () => {
    const accepted = acceptOrgAttributionLine('org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=VERIFIED organization_id=org_recorded sk-ant-FAKETESTNOTREAL');
    expect(accepted.verified).toBe(false);
    expect(accepted.line).toContain('reason=probe_unreadable');
    expect(accepted.line).not.toContain('FAKETESTNOTREAL');
  });

  it('the confirmed live path asks before it submits a run', () => {
    const entry = readFileSync('relay-bridge/julius-live-mission.ts', 'utf8');
    const ask = entry.indexOf('readAnthropicOrgAttribution(');
    const submit = entry.indexOf('const submitted = await bootstrap.submit(request)');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(submit);
    expect(entry).toContain('ORG_ATTRIBUTION_UNVERIFIED');
  });
});

/* Fixture organization ids only; the real ids come from repository variables. */
const ARCHITECT_ORG = 'aff8a85a-82c3-4ca7-afa7-8d3f63856dc4';
const CODER_ORG = 'be82739b-746c-4288-a91b-6a332816e790';
const ARCHITECT_KEY = 'FAKETESTNOTREAL-architect-key';
const CODER_KEY = 'FAKETESTNOTREAL-coder-key';
const ENV = {
  ANTHROPIC_ARCHITECT_API_KEY: ARCHITECT_KEY, JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID: ARCHITECT_ORG,
  ANTHROPIC_API_KEY: CODER_KEY, JULIUS_EXPECTED_ANTHROPIC_ORG_ID: CODER_ORG,
  OPENAI_API_KEY: 'FAKETESTNOTREAL-openai',
};

/** A stand-in for the probe child: it answers from the environment it was given, as the real script does. */
function probeAnswering(observed: { architect: string; coder: string }, seen: Record<string, string>[]): OrgProbeSpawn {
  return (env) => {
    seen.push({ ...env });
    const role = env.JULIUS_ORG_ATTRIBUTION_ROLE;
    const key = role === 'architect' ? env.ANTHROPIC_ARCHITECT_API_KEY : env.ANTHROPIC_API_KEY;
    const expected = role === 'architect' ? env.JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID : env.JULIUS_EXPECTED_ANTHROPIC_ORG_ID;
    const org = key === ARCHITECT_KEY ? observed.architect : key === CODER_KEY ? observed.coder : 'org_unknown_key';
    return org === expected
      ? `org_attribution provider=anthropic role=${role} model=claude-opus-5-5 http=200 result=VERIFIED organization_id=${org}\n`
      : `org_attribution provider=anthropic role=${role} model=claude-opus-5-5 http=200 result=ORG_ATTRIBUTION_UNVERIFIED reason=mismatch organization_id=${org} expected_organization_id=${expected}\n`;
  };
}

const MODELS = { architect: 'claude-opus-5-5', coder: 'claude-opus-5-5' };

describe('two Anthropic accounts, each attributed against its own organization', () => {
  it('each role child gets ONLY its own key, expected id and model: no fallback either way', () => {
    const seen: Record<string, string>[] = [];
    readJ1OrgAttributions(ENV, MODELS, probeAnswering({ architect: ARCHITECT_ORG, coder: CODER_ORG }, seen));
    const [architect, coder] = seen;
    expect(architect).toEqual({
      JULIUS_ORG_ATTRIBUTION_ROLE: 'architect', ANTHROPIC_ARCHITECT_API_KEY: ARCHITECT_KEY,
      JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID: ARCHITECT_ORG, RELAY_ANTHROPIC_ARCHITECT_MODEL: 'claude-opus-5-5',
    });
    expect(coder).toEqual({
      JULIUS_ORG_ATTRIBUTION_ROLE: 'coder', ANTHROPIC_API_KEY: CODER_KEY,
      JULIUS_EXPECTED_ANTHROPIC_ORG_ID: CODER_ORG, RELAY_HOSTED_CODING_MODEL: 'claude-opus-5-5',
    });
    expect(JSON.stringify(seen), 'OpenAI never reaches a probe').not.toContain('openai');
  });

  it('both verified and distinct: the gate passes and prints organization ids only', () => {
    const gate = readJ1OrgAttributions(ENV, MODELS, probeAnswering({ architect: ARCHITECT_ORG, coder: CODER_ORG }, []));
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.organizations).toEqual({ architect: ARCHITECT_ORG, coder: CODER_ORG });
    expect(gate.lines.at(-1)).toBe(`org_attribution_distinct result=DISTINCT architect_organization_id=${ARCHITECT_ORG} coder_organization_id=${CODER_ORG}`);
    expect(gate.lines.join('\n')).not.toContain('FAKETESTNOTREAL');
  });

  it('one mismatched organization (either role) is refused', () => {
    for (const observed of [{ architect: 'org_other', coder: CODER_ORG }, { architect: ARCHITECT_ORG, coder: 'org_other' }]) {
      const gate = readJ1OrgAttributions(ENV, MODELS, probeAnswering(observed, []));
      expect(gate.ok, JSON.stringify(observed)).toBe(false);
      if (!gate.ok) expect(gate.reason).toBe('org_attribution_unverified');
    }
  });

  it('the same organization for both keys is refused by name (MUTATION: same-org allowed)', () => {
    const sameEnv = { ...ENV, JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID: CODER_ORG };
    const gate = readJ1OrgAttributions(sameEnv, MODELS, probeAnswering({ architect: CODER_ORG, coder: CODER_ORG }, []));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe('architect_and_coder_share_an_organization');
    expect(gate.lines.at(-1)).toBe(`org_attribution_distinct result=REFUSED reason=architect_and_coder_share_an_organization organization_id=${CODER_ORG}`);
  });

  it('an unset architect key never borrows the coder key', () => {
    const seen: Record<string, string>[] = [];
    const reading = readAnthropicOrgAttribution({ ...ENV, ANTHROPIC_ARCHITECT_API_KEY: undefined }, 'claude-opus-5-5', 'architect', (env) => {
      seen.push({ ...env });
      return 'org_attribution provider=anthropic role=architect model=claude-opus-5-5 http=none result=ORG_ATTRIBUTION_UNVERIFIED reason=api_key_missing\n';
    });
    expect(reading.verified).toBe(false);
    expect(seen[0]?.ANTHROPIC_ARCHITECT_API_KEY).toBe('');
    expect(Object.values(seen[0] ?? {})).not.toContain(CODER_KEY);
  });

  it('the gate ids handed to LIVE must agree with the entry reading', () => {
    const own = { architect: ARCHITECT_ORG, coder: CODER_ORG };
    expect(gateVerifiedOrganizations({})).toBeNull();
    expect(gateVerifiedOrganizations({ JULIUS_VERIFIED_ARCHITECT_ORG_ID: ARCHITECT_ORG, JULIUS_VERIFIED_CODER_ORG_ID: 'bad id' })).toBeNull();
    const gate = gateVerifiedOrganizations({ JULIUS_VERIFIED_ARCHITECT_ORG_ID: ARCHITECT_ORG, JULIUS_VERIFIED_CODER_ORG_ID: CODER_ORG });
    expect(agreeWithGate(gate, own)).toEqual({ ok: true, organizations: own });
    expect(agreeWithGate(null, own)).toEqual({ ok: false, reason: 'gate_organizations_unset' });
    expect(agreeWithGate({ architect: ARCHITECT_ORG, coder: 'org_other' }, own)).toEqual({ ok: false, reason: 'gate_organizations_disagree' });
  });

  it('a role line is accepted, and its organization id read', () => {
    const line = `org_attribution provider=anthropic role=architect model=claude-opus-5-5 http=200 result=VERIFIED organization_id=${ARCHITECT_ORG}`;
    expect(acceptOrgAttributionLine(line)).toEqual({ verified: true, line, organizationId: ARCHITECT_ORG });
  });

  it('the live entry checks the gate before it submits', () => {
    const entry = readFileSync('relay-bridge/julius-live-mission.ts', 'utf8');
    const gate = entry.indexOf('readJ1OrgAttributions(env');
    const agree = entry.indexOf('agreeWithGate(gateVerifiedOrganizations(env)');
    const resolve = entry.indexOf('verifiedOrganizations, report: out');
    expect(gate).toBeGreaterThan(-1);
    expect(agree).toBeGreaterThan(gate);
    expect(resolve).toBeGreaterThan(agree);
    expect(resolve).toBeLessThan(entry.indexOf('const submitted = await bootstrap.submit(request)'));
  });
});
