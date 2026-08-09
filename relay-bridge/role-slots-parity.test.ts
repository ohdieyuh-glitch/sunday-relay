import { describe, expect, it } from 'vitest';
import { CLAUDE_ADAPTER_ID } from '../src/relay/connectors/claude-code/adapter';
import {
  ROLE_OCCUPANTS, findOccupant, type RoleOccupant,
} from '../src/relay/mission/role-slots';
import {
  HOSTED_ADAPTER_ID, HOSTED_API_KEY_ENV, LOCAL_ADAPTER_ID, surfaceForAdapter,
} from './hosted-coding-agent/hosted-readiness';
import {
  HERMES_MODES, HERMES_MODE_ENV, HERMES_SERVICE_TOKEN_ENV, HERMES_SERVICE_URL_ENV,
} from './reviewer-harness/hermes/hermes-transport';
import { architectPreflight, loadArchitectConfig } from './openai-architect';
import { resolveRoleSlotsFromEnv } from './role-slot-config';
import { createBridgeServer } from './server';
import { loadBridgeConfig } from './config';

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
    /**
     * DERIVED FROM THE PREFLIGHT, NOT RESTATED BESIDE IT. The first version of
     * this test compared the registry to three strings written into the test,
     * so renaming a variable in `openai-architect.ts` left the registry AND
     * this assertion green — a parity test that could not detect the drift it
     * exists for. `architectPreflight` already returns the names it enforces.
     */
    const enforced = architectPreflight(loadArchitectConfig({})).missing
      // The mode is reported as `NAME=value`; the registry declares names.
      .map((entry) => entry.split('=')[0])
      .sort();
    expect(enforced.length).toBe(3);
    const declared = [...occupant('prompt_architect', 'openai_gpt_architect').requiredConfig].sort();
    expect(declared).toEqual(enforced);
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
    // `allowDevelopmentDefaults`, and it keeps `npm run relay:bridge` usable
    // with no environment. Every default is unmetered or free to resolve.
    const resolution = resolveRoleSlotsFromEnv({});
    expect(resolution.hosted).toBe(false);
    expect(resolution.binding.ok).toBe(true);
    if (!resolution.binding.ok) return;
    expect(resolution.binding.bindings.prompt_architect.occupant.billingPath).toBe('none');
  });

  it('binds a laptop that has chosen the live architect and configured it', () => {
    const resolution = resolveRoleSlotsFromEnv({
      RELAY_PROMPT_ARCHITECT_MODE: 'live',
      OPENAI_API_KEY: 'sk-FAKETESTNOTREAL-never-served', // relay-boundary:allow-fixture — synthetic
      OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-test',
    });
    expect(resolution.binding.ok).toBe(true);
  });

  /**
   * Binding and `selectHermesMode` must agree about the SAME variable. They
   * disagreed in both directions: `REMOTE` silently bound the local reviewer
   * while the transport refused the value, and `romote` reported "no occupant
   * is configured" for a variable that is configured, misspelled.
   */
  it.each(['REMOTE', 'romote', 'Local', 'remote '])(
    'refuses %j as an invalid reviewer selector rather than defaulting or calling it unset',
    (mode) => {
      const resolution = resolveRoleSlotsFromEnv({
        RELAY_PROMPT_ARCHITECT_MODE: 'fusion',
        RELAY_HERMES_MODE: mode,
      });
      const refusals = resolution.binding.ok
        ? []
        : resolution.binding.problems.filter((p) => p.reason === 'invalid_selector');

      /**
       * THE CLAIM IS AGREEMENT ABOUT THE VALUE, AND NOTHING MORE — and the
       * obvious oracle is wrong. `selectHermesMode` answers `ok: false` both
       * for a value outside its vocabulary AND for a perfectly valid `remote`
       * with no service URL, so keying off its boolean tests configuration and
       * calls it parity. The shared fact is the VOCABULARY, so that is what
       * both sides are compared against, read from the transport's own list.
       */
      const valid = (HERMES_MODES as readonly string[]).includes(mode.trim());
      expect(refusals.map((p) => p.reason)).toEqual(valid ? [] : ['invalid_selector']);
    },
  );
});

/**
 * THE ROUTE, NOT A FUNCTION THAT RESEMBLES IT.
 *
 * The disclosure rule above was asserted against `resolveRoleSlotsFromEnv`'s
 * output and then declared to hold for `/relay-api/health`. It did not: nothing
 * exercised the handler, so changing `p.reason` to `p.safeMessage` in
 * `server.ts` would have failed no test. This starts the real server and reads
 * the real unauthenticated response.
 */
describe('the real /relay-api/health response', () => {
  const withServer = async (
    env: Record<string, string>,
    assert: (body: Record<string, unknown>) => void,
  ): Promise<void> => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    // No token: this route must answer without one, which is the whole reason
    // its disclosure is bounded.
    delete process.env.RELAY_BRIDGE_API_TOKEN;
    const server = createBridgeServer(
      { ...loadBridgeConfig(process.env), port: 0, host: '127.0.0.1' },
      { start: () => { throw new Error('no mission may start in this test'); } } as never,
    );
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/relay-api/health`);
      expect(response.status).toBe(200);
      assert(await response.json() as Record<string, unknown>);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  };

  it('publishes refusal CODES and never an occupant id, a message, or an environment list', async () => {
    await withServer({ RAILWAY_ENVIRONMENT: 'production' }, (body) => {
      expect(body.roleSlotsBound).toBe(false);
      const refusals = body.roleSlotRefusals as string[];
      expect(refusals.length).toBeGreaterThan(0);
      for (const code of refusals) expect(code).toMatch(/^[a-z_]+:[a-z_]+$/);

      // Nothing that names host layout may appear anywhere in the payload.
      const serialized = JSON.stringify(body);
      for (const entry of ROLE_OCCUPANTS) {
        expect(serialized).not.toContain(entry.occupantId);
        expect(serialized).not.toContain(entry.displayName);
      }
      expect(serialized).not.toContain('founder_machine');
      expect(serialized).not.toContain('Set RELAY_');
    });
  }, 30_000);

  it('reports bound slots on a deployment that has staffed its roles', async () => {
    await withServer({
      RAILWAY_ENVIRONMENT: 'production',
      RELAY_PROMPT_ARCHITECT_MODE: 'fusion',
      RELAY_ROLE_CODING_AGENT: 'claude_agent_sdk_hosted',
      ANTHROPIC_API_KEY: 'sk-ant-FAKETESTNOTREAL-never-served', // relay-boundary:allow-fixture — synthetic
      RELAY_HOSTED_CODING_MODEL: 'claude-test',
      RELAY_HERMES_MODE: 'remote',
      RELAY_HERMES_SERVICE_URL: 'https://hermes.internal',
      RELAY_HERMES_SERVICE_TOKEN: 'not-a-real-token',
      RELAY_HERMES_TRUSTED_ORIGINS: 'https://hermes.internal',
    }, (body) => {
      expect(body.roleSlotsBound).toBe(true);
      expect(body.roleSlotRefusals).toEqual([]);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('sk-ant-FAKETESTNOTREAL');
      expect(serialized).not.toContain('not-a-real-token');
    });
  }, 30_000);
});
