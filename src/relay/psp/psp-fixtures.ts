/**
 * PSP AGENT ID — deterministic DEVELOPMENT FIXTURES (PURE, shared verbatim).
 *
 * Ship on Sunday's purchase and trading backend DOES NOT EXIST YET. There is
 * no production entitlement service, no payment integration and no live
 * trading. This module is what stands in its place for development, tests and
 * the offline demo — and it is built so it can never be mistaken for the real
 * thing:
 *
 *   - every fixture credential uses the RESERVED version 0, which production
 *     validation rejects outright (see PSP_AGENT_ID_PRODUCTION_VERSIONS);
 *   - the fixture service reports `production: false`, so `evaluateEntitlement`
 *     knows it is not authoritative;
 *   - the secret material is a visible repeating DEVFXTR pattern, not
 *     realistic secret material — nothing here resembles a real credential;
 *   - `acquisitionType: 'development_fixture'` is available and used for the
 *     grant fixtures, so a record can say plainly where it came from.
 *
 * The PRODUCTION path is `createUnavailableEntitlementService()` in psp-import:
 * until a real backend exists it refuses every credential with
 * PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE. It never fabricates ownership, never
 * pretends a purchase occurred, and never invents an entitlement.
 *
 * No module that ships production behavior may import this file; a boundary
 * test asserts that.
 */

import { composePspAgentId, PSP_AGENT_ID_FIXTURE_VERSION } from './psp-agent-id';
import {
  issueEntitlement,
  type PSPAcquisitionType,
  type PSPAgentCredentialRecord,
  type PSPAgentEntitlement,
} from './psp-entitlement';
import { pspFail, pspOk, type PSPResult } from './psp-errors';
import type {
  PSPAgentImportRecord,
  PSPAgentProduct,
  PSPEntitlementServicePort,
  PSPVerifiedEntitlement,
} from './psp-import';

/* ------------------------- synthetic credentials ------------------------ */

/**
 * Obviously synthetic secret material: a repeating DEVFXTR pattern over the
 * credential alphabet. It is the right LENGTH so format validation is
 * exercised honestly, and unmistakably fake so it can never be confused for a
 * real secret in a log, a screenshot or a bug report.
 */
function fixtureSecret(marker: string): string {
  const body = `DEVFXTR${marker}`.replace(/[^0-9A-HJKMNP-TV-Z]/g, '');
  let out = '';
  while (out.length < 26) out += body;
  return out.slice(0, 26);
}

export function fixturePspAgentId(publicPrefix: string, marker: string): string {
  return composePspAgentId({
    credentialVersion: PSP_AGENT_ID_FIXTURE_VERSION,
    pspAgentId: publicPrefix,
    secret: fixtureSecret(marker),
  });
}

/** A well-formed credential that no fixture entitlement knows about. */
export const FIXTURE_UNKNOWN_CREDENTIAL = fixturePspAgentId('RY9999', 'NONE');

/* ------------------------------ products -------------------------------- */

export const FIXTURE_PRODUCTS: Record<string, PSPAgentProduct> = {
  'psp-atlas': {
    pspId: 'psp-atlas',
    pspVersionId: 'psp-atlas@2.1.0',
    name: 'Atlas Delivery Squad',
    creator: 'Sunday Labs',
    version: '2.1.0',
    agentRoles: ['Prompt Architect', 'Coding Agent', 'Reviewer'],
    supportedModels: ['claude-opus-5', 'claude-sonnet-5'],
    requiredPermissions: ['workspace.read', 'workspace.write', 'mission.run'],
    requiredTools: ['repository', 'test-runner'],
    reviewPolicy: 'Independent review required before release.',
    defaultBudgetPolicy: 'Max 12 calls / $2.00 per mission.',
    relayDogColorway: 'official-cream',
    minimumRelayVersion: '0.5.0',
  },
  'psp-lighthouse': {
    pspId: 'psp-lighthouse',
    pspVersionId: 'psp-lighthouse@1.0.0',
    name: 'Lighthouse Review Pair',
    creator: 'Harbor Studio',
    version: '1.0.0',
    agentRoles: ['Reviewer', 'Verification'],
    supportedModels: ['claude-sonnet-5'],
    requiredPermissions: ['workspace.read', 'mission.review'],
    requiredTools: ['repository'],
    reviewPolicy: 'Read-only reviewer; never approves its own work.',
    defaultBudgetPolicy: 'Max 6 calls / $0.75 per review.',
    relayDogColorway: 'official-cream',
    minimumRelayVersion: '0.5.0',
  },
  /** Requires a Relay newer than any fixture workspace — proves the
   *  incompatible path without inventing a broken product. */
  'psp-horizon': {
    pspId: 'psp-horizon',
    pspVersionId: 'psp-horizon@9.0.0',
    name: 'Horizon Preview Squad',
    creator: 'Sunday Labs',
    version: '9.0.0',
    agentRoles: ['Prompt Architect'],
    supportedModels: ['claude-opus-5'],
    requiredPermissions: ['workspace.read'],
    requiredTools: ['repository'],
    reviewPolicy: 'Independent review required before release.',
    defaultBudgetPolicy: 'Max 4 calls / $0.50 per mission.',
    relayDogColorway: 'official-cream',
    minimumRelayVersion: '99.0.0',
  },
};

/* ----------------------------- scenarios -------------------------------- */

export const FIXTURE_NOW = '2026-07-28T12:00:00.000Z';
export const FIXTURE_HOLDER_USER_ID = 'user-holder';
export const FIXTURE_OTHER_USER_ID = 'user-other';
export const FIXTURE_WORKSPACE_ID = 'ws-relay-001';

export interface FixtureScenario {
  key: string;
  credential: string;
  entitlement: PSPAgentEntitlement;
  credentialRecord: PSPAgentCredentialRecord;
  product: PSPAgentProduct;
}

interface ScenarioSpec {
  key: string;
  prefix: string;
  marker: string;
  pspId: keyof typeof FIXTURE_PRODUCTS;
  acquisitionType: PSPAcquisitionType;
  holder?: string;
  mutate?: (e: PSPAgentEntitlement) => PSPAgentEntitlement;
  expiresAt?: string;
  marketplaceTransactionId?: string;
  tradeTransactionId?: string;
}

const SPECS: ScenarioSpec[] = [
  {
    key: 'purchased', prefix: 'RY0001', marker: 'A', pspId: 'psp-atlas',
    acquisitionType: 'purchase', marketplaceTransactionId: 'txn-fixture-0001',
  },
  {
    key: 'traded', prefix: 'RY0002', marker: 'B', pspId: 'psp-lighthouse',
    acquisitionType: 'trade', tradeTransactionId: 'trade-fixture-0001',
  },
  {
    key: 'creator_grant', prefix: 'RY0003', marker: 'C', pspId: 'psp-atlas',
    acquisitionType: 'creator_grant',
  },
  {
    key: 'admin_grant', prefix: 'RY0004', marker: 'D', pspId: 'psp-lighthouse',
    acquisitionType: 'admin_grant',
  },
  {
    key: 'development_fixture', prefix: 'RY0005', marker: 'E', pspId: 'psp-atlas',
    acquisitionType: 'development_fixture',
  },
  {
    key: 'expired', prefix: 'RY0006', marker: 'F', pspId: 'psp-atlas',
    acquisitionType: 'purchase', expiresAt: '2026-01-01T00:00:00.000Z',
  },
  {
    key: 'revoked', prefix: 'RY0007', marker: 'G', pspId: 'psp-atlas',
    acquisitionType: 'purchase',
    mutate: (e) => ({ ...e, status: 'revoked', revokedAt: '2026-06-01T00:00:00.000Z' }),
  },
  {
    key: 'already_redeemed', prefix: 'RY0008', marker: 'H', pspId: 'psp-atlas',
    acquisitionType: 'purchase',
    mutate: (e) => ({
      ...e, status: 'redeemed', redeemedAt: '2026-06-02T00:00:00.000Z',
      redeemedByUserId: FIXTURE_HOLDER_USER_ID, redeemedIntoWorkspaceId: 'ws-relay-000',
    }),
  },
  {
    key: 'transferred', prefix: 'RY0009', marker: 'J', pspId: 'psp-atlas',
    acquisitionType: 'purchase',
    mutate: (e) => ({
      ...e, status: 'transferred', transferredAt: '2026-06-03T00:00:00.000Z',
      supersededByEntitlementId: 'ent-fixture-transferred-next',
    }),
  },
  {
    key: 'disputed', prefix: 'RY0010', marker: 'K', pspId: 'psp-atlas',
    acquisitionType: 'trade', mutate: (e) => ({ ...e, status: 'disputed' }),
  },
  {
    key: 'not_owned', prefix: 'RY0011', marker: 'M', pspId: 'psp-atlas',
    acquisitionType: 'purchase', holder: FIXTURE_OTHER_USER_ID,
  },
  {
    key: 'incompatible', prefix: 'RY0012', marker: 'N', pspId: 'psp-horizon',
    acquisitionType: 'purchase',
  },
];

function buildScenario(spec: ScenarioSpec): FixtureScenario {
  const credential = fixturePspAgentId(spec.prefix, spec.marker);
  const product = FIXTURE_PRODUCTS[spec.pspId];
  const issued = issueEntitlement({
    entitlementId: `ent-fixture-${spec.key}`,
    pspId: product.pspId,
    pspVersionId: product.pspVersionId,
    acquisitionType: spec.acquisitionType,
    credential,
    issuedToUserId: spec.holder ?? FIXTURE_HOLDER_USER_ID,
    issuedAt: '2026-05-01T00:00:00.000Z',
    ...(spec.expiresAt ? { expiresAt: spec.expiresAt } : {}),
    ...(spec.marketplaceTransactionId
      ? { marketplaceTransactionId: spec.marketplaceTransactionId } : {}),
    ...(spec.tradeTransactionId ? { tradeTransactionId: spec.tradeTransactionId } : {}),
    salt: `fixture-salt-${spec.key}`,
  });
  if (!issued.ok) throw new Error(`fixture ${spec.key} could not be issued`);
  const entitlement = spec.mutate ? spec.mutate(issued.value.entitlement) : issued.value.entitlement;
  return {
    key: spec.key,
    credential,
    entitlement,
    credentialRecord: issued.value.credentialRecord,
    product,
  };
}

export function fixtureScenarios(): FixtureScenario[] {
  return SPECS.map(buildScenario);
}

export function fixtureScenario(key: string): FixtureScenario {
  const found = fixtureScenarios().find((s) => s.key === key);
  if (!found) throw new Error(`unknown PSP fixture scenario: ${key}`);
  return found;
}

/* --------------------------- fixture service ---------------------------- */

export interface FixtureServiceOptions {
  /** Simulate the entitlement service being unreachable. */
  unavailable?: boolean;
  scenarios?: FixtureScenario[];
}

/**
 * A deterministic, in-memory entitlement service for development and tests.
 * NON-PRODUCTION by construction: `production` is permanently false.
 */
export function createFixtureEntitlementService(
  options: FixtureServiceOptions = {},
): PSPEntitlementServicePort & { imported: PSPAgentImportRecord[] } {
  const scenarios = options.scenarios ?? fixtureScenarios();
  const entitlements = new Map<string, FixtureScenario>();
  for (const scenario of scenarios) entitlements.set(scenario.credential, scenario);
  const imported: PSPAgentImportRecord[] = [];

  return {
    production: false,
    imported,
    lookup(input): PSPResult<PSPVerifiedEntitlement> {
      if (options.unavailable) return pspFail('PSP_AGENT_IMPORT_SERVICE_UNAVAILABLE');
      const scenario = entitlements.get(input.credential.trim().toUpperCase());
      if (!scenario) return pspFail('PSP_AGENT_ENTITLEMENT_NOT_FOUND');
      return pspOk({
        entitlement: scenario.entitlement,
        credentialRecord: scenario.credentialRecord,
        product: scenario.product,
      });
    },
    commit(input): PSPResult<PSPAgentImportRecord> {
      const scenario = [...entitlements.values()]
        .find((s) => s.entitlement.entitlementId === input.entitlement.entitlementId);
      if (scenario) {
        entitlements.set(scenario.credential, {
          ...scenario,
          entitlement: input.entitlement,
          credentialRecord: input.credentialRecord,
        });
      }
      imported.push(input.record);
      return pspOk(input.record);
    },
  };
}
