import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { acceptOrgAttributionLine } from './anthropic-org-attribution';

describe('the live entry accepts only a closed organization-attribution line', () => {
  it('a verified line is the gate', () => {
    const line = 'org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=VERIFIED organization_id=org_recorded';
    expect(acceptOrgAttributionLine(`${line}\n`)).toEqual({ verified: true, line });
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
