/**
 * THE LIVE ENTRY'S ORG GATE.
 *
 * API-billed Anthropic spend is attributable only when the spend-free models
 * read reports the organization id the operator named. This module runs that
 * script and accepts only its closed line. Stderr is not forwarded. A line that
 * is not the closed shape is `probe_unreadable`, never the raw text.
 *
 * J1 has TWO Anthropic roles on two accounts (`J1_ROLE_CREDENTIALS`): each is
 * read with its own key against its own expected organization, and the two
 * verified organizations must differ.
 */

import { spawnSync } from 'node:child_process';

import { j1RoleCredential, type VerifiedRoleOrganizations } from './live-composition';

const ROLE = '( role=(?:architect|coder))?';
const VERIFIED_LINE = new RegExp(`^org_attribution provider=anthropic${ROLE} model=[A-Za-z0-9._-]+ http=200 result=VERIFIED organization_id=([A-Za-z0-9_-]+)$`, 'u');
const UNVERIFIED_LINE = new RegExp(`^org_attribution provider=anthropic${ROLE} model=(?:none|[A-Za-z0-9._-]+) http=(none|[0-9]{3}) result=ORG_ATTRIBUTION_UNVERIFIED reason=[a-z_]+( organization_id=[A-Za-z0-9_-]+ expected_organization_id=[A-Za-z0-9_-]+)?$`, 'u');

export const ORG_ATTRIBUTION_UNVERIFIED = 'ORG_ATTRIBUTION_UNVERIFIED';

export interface OrgAttributionReading {
  readonly verified: boolean;
  readonly line: string;
  /** The verified organization id, and only when verified. */
  readonly organizationId: string | null;
}

/** Keep a closed attribution line. Anything else becomes an unreadable refusal. */
export function acceptOrgAttributionLine(raw: string): OrgAttributionReading {
  const line = raw.split('\n').map((entry) => entry.trim()).find((entry) => entry.startsWith('org_attribution ')) ?? '';
  const verified = VERIFIED_LINE.exec(line);
  if (verified !== null) return { verified: true, line, organizationId: verified[2] ?? null };
  if (UNVERIFIED_LINE.test(line)) return { verified: false, line, organizationId: null };
  return {
    verified: false,
    line: 'org_attribution provider=anthropic model=none http=none result=ORG_ATTRIBUTION_UNVERIFIED reason=probe_unreadable',
    organizationId: null,
  };
}

/** The test seam: how the probe script is run. Production spawns node. */
export type OrgProbeSpawn = (env: Readonly<Record<string, string>>) => string;

const spawnProbe: OrgProbeSpawn = (env) => spawnSync(process.execPath, ['scripts/julius-org-attribution.mjs'], {
  encoding: 'utf8', cwd: process.cwd(), env: { ...env },
}).stdout ?? '';

/**
 * Run the spend-free probe for ONE role in a child whose environment holds that
 * role's key, expected organization id and model — and nothing else this process
 * was given. The key is not an argument. `coder` is the Coding Agent's row and
 * `architect` the Agentic Architect's; neither reads the other's variables.
 */
export function readAnthropicOrgAttribution(
  env: Readonly<Record<string, string | undefined>>,
  model: string,
  role: 'coder' | 'architect' = 'coder',
  spawn: OrgProbeSpawn = spawnProbe,
): OrgAttributionReading {
  const row = j1RoleCredential(role === 'architect' ? 'PROMPT_ARCHITECT' : 'CODING_AGENT');
  return acceptOrgAttributionLine(spawn({
    JULIUS_ORG_ATTRIBUTION_ROLE: role,
    [row.keyEnv]: env[row.keyEnv] ?? '',
    [row.expectedOrgEnv as string]: env[row.expectedOrgEnv as string] ?? '',
    [row.modelEnv]: model,
  }));
}

export type J1OrgGate =
  | { readonly ok: true; readonly lines: readonly string[]; readonly organizations: VerifiedRoleOrganizations }
  | { readonly ok: false; readonly lines: readonly string[]; readonly reason: 'org_attribution_unverified' | 'architect_and_coder_share_an_organization' };

/**
 * BOTH ANTHROPIC ROLES, EACH AGAINST ITS OWN ORGANIZATION, AND THE TWO DIFFERENT.
 *
 * Every line printed is a closed attribution line or the one distinctness line,
 * which names organization ids and nothing else.
 */
export function readJ1OrgAttributions(
  env: Readonly<Record<string, string | undefined>>,
  models: { readonly architect: string; readonly coder: string },
  spawn: OrgProbeSpawn = spawnProbe,
): J1OrgGate {
  const architect = readAnthropicOrgAttribution(env, models.architect, 'architect', spawn);
  const coder = readAnthropicOrgAttribution(env, models.coder, 'coder', spawn);
  const lines = [architect.line, coder.line];
  if (!architect.verified || !coder.verified || architect.organizationId === null || coder.organizationId === null) {
    return { ok: false, lines, reason: 'org_attribution_unverified' };
  }
  if (architect.organizationId === coder.organizationId) {
    return {
      ok: false,
      lines: [...lines, `org_attribution_distinct result=REFUSED reason=architect_and_coder_share_an_organization organization_id=${coder.organizationId}`],
      reason: 'architect_and_coder_share_an_organization',
    };
  }
  return {
    ok: true,
    lines: [...lines, `org_attribution_distinct result=DISTINCT architect_organization_id=${architect.organizationId} coder_organization_id=${coder.organizationId}`],
    organizations: { architect: architect.organizationId, coder: coder.organizationId },
  };
}

const SAFE_ORG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

/**
 * THE PRE-MARKER GATE'S VERIFIED ORGANIZATIONS, as the workflow handed them to
 * LIVE (`JULIUS_VERIFIED_ARCHITECT_ORG_ID`, `JULIUS_VERIFIED_CODER_ORG_ID`).
 * Null when either is absent or not an organization id.
 */
export function gateVerifiedOrganizations(env: Readonly<Record<string, string | undefined>>): VerifiedRoleOrganizations | null {
  const architect = env.JULIUS_VERIFIED_ARCHITECT_ORG_ID?.trim() ?? '';
  const coder = env.JULIUS_VERIFIED_CODER_ORG_ID?.trim() ?? '';
  return SAFE_ORG.test(architect) && SAFE_ORG.test(coder) ? { architect, coder } : null;
}

/**
 * THE GATE'S IDS ARE THE ONES THE COMPOSITION IS CHECKED AGAINST. The entry's own
 * reading is defence in depth: it must agree with the gate, or nothing is submitted.
 */
export function agreeWithGate(
  gate: VerifiedRoleOrganizations | null,
  own: VerifiedRoleOrganizations,
): { readonly ok: true; readonly organizations: VerifiedRoleOrganizations } | { readonly ok: false; readonly reason: 'gate_organizations_unset' | 'gate_organizations_disagree' } {
  if (gate === null) return { ok: false, reason: 'gate_organizations_unset' };
  if (gate.architect !== own.architect || gate.coder !== own.coder) return { ok: false, reason: 'gate_organizations_disagree' };
  return { ok: true, organizations: gate };
}
