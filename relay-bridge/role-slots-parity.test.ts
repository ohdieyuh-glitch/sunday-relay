import { describe, expect, it } from 'vitest';
import { CLAUDE_ADAPTER_ID } from '../src/relay/connectors/claude-code/adapter';
import {
  ROLE_OCCUPANTS, findOccupant, type RoleOccupant,
} from '../src/relay/mission/role-slots';
import {
  HOSTED_ADAPTER_ID, HOSTED_API_KEY_ENV, LOCAL_ADAPTER_ID, surfaceForAdapter,
} from './hosted-coding-agent/hosted-readiness';
import {
  HERMES_MODE_ENV, HERMES_SERVICE_TOKEN_ENV, HERMES_SERVICE_URL_ENV,
} from './reviewer-harness/hermes/hermes-transport';
import { loadArchitectConfig } from './openai-architect';
import { resolveRoleSlotsFromEnv } from './role-slot-config';

/**
 * THE REGISTRY AND THE BRIDGE MUST NAME THE SAME THINGS.
 *
 * `src/relay/mission/role-slots` declares, per occupant, which environment
 * variables it needs and which adapter id identifies it. The bridge declares
 * the same strings as its own constants, because the bridge is what actually
 * reads them. Two independent lists of identical strings drift, and the
 * drifted one is always the one an operator reads off a status page while the
 * other is the one the code uses.
 *
 * This file is on the BRIDGE side deliberately. The registry is pure domain
 * and may not import server code — not even in a test — so the direction of
 * this check is the only one the layering permits.
 */

const occupant = (role: Parameters<typeof findOccupant>[0], id: string): RoleOccupant => {
  const found = findOccupant(role, id);
  expect(found, `the registry no longer has ${role}/${id}`).not.toBeNull();
  return found as RoleOccupant;
};

describe('role-slot registry parity with the bridge', () => {
  it('asks for the credential variable the hosted Coding Agent actually reads', () => {
    expect(occupant('coding_agent', 'claude_agent_sdk_hosted').requiredConfig)
      .toContain(HOSTED_API_KEY_ENV);
  });

  it('asks for exactly the variables remote Hermes selection actually requires', () => {
    expect([...occupant('reviewer', 'hermes_remote_service').requiredConfig].sort())
      .toEqual([HERMES_MODE_ENV, HERMES_SERVICE_URL_ENV, HERMES_SERVICE_TOKEN_ENV].sort());
  });

  /**
   * `loadArchitectConfig` reads three variables and reports the missing ones by
   * name. The registry must ask for the same three, or a bound architect slot
   * would pass binding and then fail its own preflight — a refusal arriving one
   * layer too late to be useful.
   */
  it('asks for the variables the Prompt Architect preflight itself names', () => {
    const missing = loadArchitectConfig({});
    expect(missing.apiKey).toBeUndefined();
    const declared = [...occupant('prompt_architect', 'openai_gpt_architect').requiredConfig].sort();
    expect(declared).toEqual([
      'OPENAI_API_KEY', 'OPENAI_PROMPT_ARCHITECT_MODEL', 'RELAY_PROMPT_ARCHITECT_MODE',
    ]);
  });

  it('identifies each Coding Agent occupant by the adapter id its surface publishes', () => {
    expect(occupant('coding_agent', 'claude_code_local').adapterId).toBe(LOCAL_ADAPTER_ID);
    expect(occupant('coding_agent', 'claude_agent_sdk_hosted').adapterId).toBe(HOSTED_ADAPTER_ID);
    // One value with two names. If these diverge, `surfaceForAdapter` and the
    // registry disagree about what ran and both look right in isolation.
    expect(LOCAL_ADAPTER_ID).toBe(CLAUDE_ADAPTER_ID);
  });

  /**
   * Every Coding Agent occupant must map to a REAL surface. `surfaceForAdapter`
   * answers `unavailable` for an id it does not recognise, so a registry entry
   * whose adapter id it cannot place would report a run as having happened
   * nowhere.
   */
  it('maps every registered Coding Agent occupant onto a known execution surface', () => {
    for (const entry of ROLE_OCCUPANTS.filter((o) => o.role === 'coding_agent')) {
      expect(surfaceForAdapter(entry.adapterId)).not.toBe('unavailable');
    }
  });
});

/**
 * WHAT THE PUBLIC HEALTH ROUTE MAY SAY ABOUT ROLE SLOTS.
 *
 * `/relay-api/health` is unauthenticated. It has always disclosed which
 * architect VARIABLES are unset, so a refusal CODE is strictly less than what
 * is already there. A refusal MESSAGE is not: it names occupants and the
 * environments they support, which is host layout. This holds that line.
 */
describe('role-slot disclosure on the unauthenticated health route', () => {
  it('produces codes that name a role and a reason, and never a message', () => {
    const resolution = resolveRoleSlotsFromEnv({ RAILWAY_ENVIRONMENT: 'production' });
    expect(resolution.binding.ok).toBe(false);
    if (resolution.binding.ok) return;
    const codes = resolution.binding.problems.map((p) => `${p.role}:${p.reason}`);
    expect(codes).toContain('coding_agent:no_occupant_requested');
    for (const code of codes) {
      // A code is two identifiers and a colon. Anything with a space is prose,
      // and prose is what carries host layout.
      expect(code).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  it('binds on a developer machine with nothing configured at all', () => {
    // A laptop may default; that asymmetry is the whole point of
    // `allowDevelopmentDefaults`, and it keeps `npm run relay:bridge` usable.
    const resolution = resolveRoleSlotsFromEnv({});
    expect(resolution.hosted).toBe(false);
    expect(resolution.binding.ok).toBe(false);
    if (resolution.binding.ok) return;
    // The architect is the one role a laptop still cannot default: its mode
    // selects the occupant, and no mode means no decision has been made.
    expect(resolution.binding.problems.map((p) => p.role)).toEqual(['prompt_architect']);
  });

  it('binds a laptop that has chosen an architect mode', () => {
    const resolution = resolveRoleSlotsFromEnv({ RELAY_PROMPT_ARCHITECT_MODE: 'fusion' });
    expect(resolution.binding.ok).toBe(true);
  });
});
