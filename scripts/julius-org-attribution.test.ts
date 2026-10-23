import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { judgeAnthropicOrgAttribution, probeAnthropicOrganization } = createRequire(import.meta.url)('./julius-org-attribution.mjs') as {
  judgeAnthropicOrgAttribution: (expected: string | undefined, observed: string | null | undefined) => {
    verified: boolean;
    reason: string | null;
    organizationId: string | null;
  };
  probeAnthropicOrganization: (input: {
    apiKey?: string;
    expectedOrganizationId?: string;
    model?: string;
    fetchImpl: (url: string, init?: RequestInit) => Promise<{ status: number; headers: { get: (name: string) => string | null } }>;
  }) => Promise<string>;
};

const KEY = 'sk-ant-FAKETESTNOTREAL';
const MODEL = 'claude-opus-5-5';

function fetchReturning(status: number, organizationId: string | null, seen: { url?: string; apiKey?: string; bodyRead: boolean }) {
  return async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.apiKey = new Headers(init?.headers).get('x-api-key') ?? undefined;
    return {
      status,
      headers: { get: (name: string) => name.toLowerCase() === 'anthropic-organization-id' ? organizationId : null },
      text: async () => { seen.bodyRead = true; return 'body-must-not-be-read'; },
      json: async () => { seen.bodyRead = true; return {}; },
    };
  };
}

describe('Anthropic organization attribution is spend-free and fail-closed', () => {
  it('a matching organization id is verified', () => {
    expect(judgeAnthropicOrgAttribution('org_recorded', 'org_recorded')).toEqual({
      verified: true, reason: null, organizationId: 'org_recorded',
    });
  });

  it('an unset expected id, a missing header, and a mismatch are ORG_ATTRIBUTION_UNVERIFIED', () => {
    expect(judgeAnthropicOrgAttribution(undefined, 'org_recorded').reason).toBe('expected_unset');
    expect(judgeAnthropicOrgAttribution('   ', 'org_recorded').reason).toBe('expected_unset');
    expect(judgeAnthropicOrgAttribution('org_recorded', null).reason).toBe('header_missing');
    expect(judgeAnthropicOrgAttribution('org_recorded', '  ').reason).toBe('header_missing');
    const mismatch = judgeAnthropicOrgAttribution('org_recorded', 'org_other');
    expect(mismatch.verified).toBe(false);
    expect(mismatch.reason).toBe('mismatch');
    expect(mismatch.organizationId).toBe('org_other');
  });

  it('a credential-shaped header is not recorded', () => {
    const judged = judgeAnthropicOrgAttribution('org_recorded', 'sk-ant-FAKETESTNOTREAL');
    expect(judged).toEqual({ verified: false, reason: 'header_unusable', organizationId: null });
  });

  it('the probe records only a matching organization id and does not read the body', async () => {
    const seen: { url?: string; bodyRead: boolean } = { bodyRead: false };
    const line = await probeAnthropicOrganization({
      apiKey: KEY, expectedOrganizationId: 'org_recorded', model: MODEL,
      fetchImpl: fetchReturning(200, 'org_recorded', seen),
    });
    expect(line).toBe('org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=VERIFIED organization_id=org_recorded');
    expect(seen.url).toBe('https://api.anthropic.com/v1/models/claude-opus-5-5');
    expect(seen.bodyRead).toBe(false);
    expect(line).not.toContain(KEY);
  });

  it('a mismatch names both organization ids and not the key', async () => {
    const line = await probeAnthropicOrganization({
      apiKey: KEY, expectedOrganizationId: 'org_recorded', model: MODEL,
      fetchImpl: fetchReturning(200, 'org_other', { bodyRead: false }),
    });
    expect(line).toBe('org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=ORG_ATTRIBUTION_UNVERIFIED reason=mismatch organization_id=org_other expected_organization_id=org_recorded');
    expect(line).not.toContain(KEY);
  });

  it('a missing key, a missing expected id, and a failed probe do not call out a balance', async () => {
    const missingKey = await probeAnthropicOrganization({
      apiKey: '', expectedOrganizationId: 'org_recorded', model: MODEL,
      fetchImpl: () => { throw new Error(`socket ${KEY}`); },
    });
    expect(missingKey).toContain('reason=api_key_missing');
    expect(missingKey).not.toContain(KEY);
    const missingExpected = await probeAnthropicOrganization({
      apiKey: KEY, expectedOrganizationId: '', model: MODEL,
      fetchImpl: () => { throw new Error('should not be called'); },
    });
    expect(missingExpected).toContain('reason=expected_unset');
    const failed = await probeAnthropicOrganization({
      apiKey: KEY, expectedOrganizationId: 'org_recorded', model: MODEL,
      fetchImpl: async () => { throw new Error(`connect ${KEY}`); },
    });
    expect(failed).toContain('reason=probe_failed');
    expect(failed).not.toContain(KEY);
    const unauthorized = await probeAnthropicOrganization({
      apiKey: KEY, expectedOrganizationId: 'org_recorded', model: MODEL,
      fetchImpl: fetchReturning(401, null, { bodyRead: false }),
    });
    expect(unauthorized).toContain('http=401');
    expect(unauthorized).toContain('reason=unauthenticated');
  });
});
