/**
 * THE LIVE ENTRY'S ORG GATE.
 *
 * API-billed Coding Agent spend is attributable only when the spend-free
 * models read reports the organization id the operator named. This module
 * runs that script and accepts only its closed line. Stderr is not forwarded.
 * A line that is not the closed shape is `probe_unreadable`, never the raw text.
 */

import { spawnSync } from 'node:child_process';

const VERIFIED_LINE = /^org_attribution provider=anthropic model=[A-Za-z0-9._-]+ http=200 result=VERIFIED organization_id=[A-Za-z0-9_-]+$/u;
const UNVERIFIED_LINE = /^org_attribution provider=anthropic model=[A-Za-z0-9._-]+ http=(none|[0-9]{3}) result=ORG_ATTRIBUTION_UNVERIFIED reason=[a-z_]+( organization_id=[A-Za-z0-9_-]+ expected_organization_id=[A-Za-z0-9_-]+)?$/u;

export const ORG_ATTRIBUTION_UNVERIFIED = 'ORG_ATTRIBUTION_UNVERIFIED';

/** Keep a closed attribution line. Anything else becomes an unreadable refusal. */
export function acceptOrgAttributionLine(raw: string): { readonly verified: boolean; readonly line: string } {
  const line = raw.split('\n').map((entry) => entry.trim()).find((entry) => entry.startsWith('org_attribution ')) ?? '';
  if (VERIFIED_LINE.test(line)) return { verified: true, line };
  if (UNVERIFIED_LINE.test(line)) return { verified: false, line };
  return {
    verified: false,
    line: 'org_attribution provider=anthropic model=none http=none result=ORG_ATTRIBUTION_UNVERIFIED reason=probe_unreadable',
  };
}

/**
 * Run the spend-free probe in a child whose environment holds the key, the
 * expected organization id, and the coder model — and nothing else that this
 * process was given. The key is not an argument.
 */
export function readAnthropicOrgAttribution(
  env: Readonly<Record<string, string | undefined>>,
  model: string,
): { readonly verified: boolean; readonly line: string } {
  const result = spawnSync(process.execPath, ['scripts/julius-org-attribution.mjs'], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? '',
      JULIUS_EXPECTED_ANTHROPIC_ORG_ID: env.JULIUS_EXPECTED_ANTHROPIC_ORG_ID ?? '',
      RELAY_HOSTED_CODING_MODEL: model,
    },
  });
  return acceptOrgAttributionLine(result.stdout ?? '');
}
