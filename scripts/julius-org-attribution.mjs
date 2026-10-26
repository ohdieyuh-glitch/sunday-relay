#!/usr/bin/env node
/**
 * SPEND-FREE ANTHROPIC ORGANIZATION ATTRIBUTION.
 *
 * `GET /v1/models/<id>` reads model metadata. It generates no tokens and is
 * not a completion. The only header this keeps is `anthropic-organization-id`.
 * It is compared with `JULIUS_EXPECTED_ANTHROPIC_ORG_ID`. Anything else —
 * the key missing, the expected id unset, the header missing or unusable, or
 * the two ids different — is `ORG_ATTRIBUTION_UNVERIFIED`.
 *
 * The API key is read from the environment and placed on the request. It is
 * never printed, and a transport error's text is not printed either.
 *
 * TWO ANTHROPIC ROLES, TWO ACCOUNTS. `JULIUS_ORG_ATTRIBUTION_ROLE` picks whose
 * variables are read, and the line then says `role=<role>`:
 *   - `coder` (and unset, the historical line without `role=`): ANTHROPIC_API_KEY,
 *     JULIUS_EXPECTED_ANTHROPIC_ORG_ID, RELAY_HOSTED_CODING_MODEL;
 *   - `architect`: ANTHROPIC_ARCHITECT_API_KEY,
 *     JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID, RELAY_ANTHROPIC_ARCHITECT_MODEL.
 * Neither role reads the other's variables, so neither can fall back to the other.
 * The names match `J1_ROLE_CREDENTIALS` in relay-bridge/julius/role-credentials.ts,
 * and a test holds them equal.
 */

import { pathToFileURL } from 'node:url';

const ORG_HEADER = 'anthropic-organization-id';
const SAFE_ORG_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const CREDENTIAL_SHAPED = /(sk-|xai-|ghp_|gho_|bearer|authorization|api[_-]?key|private[-_ ]?key)/iu;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

/** Which variables each role is attributed from. */
export const ORG_ATTRIBUTION_ROLE_ENV = Object.freeze({
  coder: Object.freeze({ key: 'ANTHROPIC_API_KEY', expected: 'JULIUS_EXPECTED_ANTHROPIC_ORG_ID', model: 'RELAY_HOSTED_CODING_MODEL' }),
  architect: Object.freeze({ key: 'ANTHROPIC_ARCHITECT_API_KEY', expected: 'JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID', model: 'RELAY_ANTHROPIC_ARCHITECT_MODEL' }),
});
const roleToken = (role) => (role === 'architect' || role === 'coder' ? ` role=${role}` : '');

/**
 * Compare the expected organization id with the one header. Neither value is
 * logged here; the caller prints only the closed line from {@link attributionLine}.
 */
export function judgeAnthropicOrgAttribution(expected, observed) {
  const expectedId = typeof expected === 'string' ? expected.trim() : '';
  const observedId = typeof observed === 'string' ? observed.trim() : '';
  if (expectedId === '') return { verified: false, reason: 'expected_unset', organizationId: null };
  if (observedId === '') return { verified: false, reason: 'header_missing', organizationId: null };
  if (!SAFE_ORG_ID.test(observedId) || CREDENTIAL_SHAPED.test(observedId)) {
    return { verified: false, reason: 'header_unusable', organizationId: null };
  }
  if (!SAFE_ORG_ID.test(expectedId) || CREDENTIAL_SHAPED.test(expectedId)) {
    return { verified: false, reason: 'expected_unusable', organizationId: null };
  }
  if (observedId !== expectedId) {
    return { verified: false, reason: 'mismatch', organizationId: observedId, expectedOrganizationId: expectedId };
  }
  return { verified: true, reason: null, organizationId: observedId };
}

/** One closed line. A verified line carries the organization id and nothing else. */
export function attributionLine(input) {
  const model = SAFE_MODEL.test(input.model ?? '') ? input.model : 'none';
  const http = input.http === 'none' || /^[0-9]{3}$/u.test(input.http ?? '') ? input.http : 'none';
  const role = roleToken(input.role);
  if (input.verified === true && SAFE_ORG_ID.test(input.organizationId ?? '')) {
    return `org_attribution provider=anthropic${role} model=${model} http=${http} result=VERIFIED organization_id=${input.organizationId}`;
  }
  const reason = /^[a-z_]+$/u.test(input.reason ?? '') ? input.reason : 'probe_unreadable';
  const compared = reason === 'mismatch'
    && SAFE_ORG_ID.test(input.organizationId ?? '')
    && SAFE_ORG_ID.test(input.expectedOrganizationId ?? '')
    ? ` organization_id=${input.organizationId} expected_organization_id=${input.expectedOrganizationId}`
    : '';
  return `org_attribution provider=anthropic${role} model=${model} http=${http} result=ORG_ATTRIBUTION_UNVERIFIED reason=${reason}${compared}`;
}

/**
 * Read the organization header from the models endpoint. `fetchImpl` is the
 * test seam. The response body is not read.
 */
export async function probeAnthropicOrganization(input) {
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey : '';
  const expected = typeof input.expectedOrganizationId === 'string' ? input.expectedOrganizationId : '';
  if (apiKey.trim() === '') {
    return attributionLine({ role: input.role, verified: false, reason: 'api_key_missing', http: 'none', model });
  }
  if (!SAFE_MODEL.test(model)) {
    return attributionLine({ role: input.role, verified: false, reason: 'model_unusable', http: 'none', model: 'none' });
  }
  if (expected.trim() === '') {
    return attributionLine({ role: input.role, verified: false, reason: 'expected_unset', http: 'none', model });
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
      method: 'GET',
      redirect: 'error',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
  } catch {
    return attributionLine({ role: input.role, verified: false, reason: 'probe_failed', http: 'none', model });
  }
  const http = String(response?.status ?? '');
  if (response?.status !== 200) {
    const reason = response?.status === 401 || response?.status === 403
      ? 'unauthenticated'
      : response?.status === 404 ? 'model_not_found' : 'probe_failed';
    return attributionLine({ role: input.role, verified: false, reason, http: /^[0-9]{3}$/u.test(http) ? http : 'none', model });
  }
  const header = typeof response.headers?.get === 'function' ? response.headers.get(ORG_HEADER) : null;
  const judged = judgeAnthropicOrgAttribution(expected, header);
  return attributionLine({ role: input.role, ...judged, http, model });
}

async function main() {
  const declared = process.env.JULIUS_ORG_ATTRIBUTION_ROLE ?? '';
  if (declared !== '' && declared !== 'architect' && declared !== 'coder') {
    process.stdout.write('org_attribution provider=anthropic model=none http=none result=ORG_ATTRIBUTION_UNVERIFIED reason=role_unknown\n');
    process.exitCode = 1;
    return;
  }
  const names = ORG_ATTRIBUTION_ROLE_ENV[declared === 'architect' ? 'architect' : 'coder'];
  const line = await probeAnthropicOrganization({
    apiKey: process.env[names.key],
    expectedOrganizationId: process.env[names.expected],
    model: process.env[names.model],
    role: declared === '' ? undefined : declared,
  });
  process.stdout.write(`${line}\n`);
  process.exitCode = line.includes(' result=VERIFIED ') ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
