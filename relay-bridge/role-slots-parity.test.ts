import { describe, expect, it } from 'vitest';
import { CLAUDE_ADAPTER_ID } from '../src/relay/connectors/claude-code/adapter';
import {
  ROLE_OCCUPANTS, findOccupant, occupantsForRole, type RoleOccupant,
} from '../src/relay/mission/role-slots';
import {
  HOSTED_ADAPTER_ID, HOSTED_API_KEY_ENV, HOSTED_MODEL_ENV, LOCAL_ADAPTER_ID, surfaceForAdapter,
} from './hosted-coding-agent/hosted-readiness';
import {
  HERMES_MODE_ENV, HERMES_SERVICE_TOKEN_ENV, HERMES_SERVICE_URL_ENV,
  HERMES_TRUSTED_ORIGINS_ENV,
} from './reviewer-harness/hermes/hermes-transport';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { architectPreflight, loadArchitectConfig } from './openai-architect';
import { selectArchitectPath } from './mission';
import {
  MISSION_DISPATCHABLE_OCCUPANTS, architectOccupantFor, resolveRoleSlotsFromEnv,
} from './role-slot-config';
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
  it('asks for exactly the variables the hosted Coding Agent probe actually reads', () => {
    // BOTH names, held against the bridge's own constants. Asserting only the
    // credential let `RELAY_HOSTED_CODING_MODEL` be a hard-coded string in the
    // registry that no parity check covered — the drift this file exists for.
    expect([...occupant('coding_agent', 'claude_agent_sdk_hosted').requiredConfig].sort())
      .toEqual([HOSTED_API_KEY_ENV, HOSTED_MODEL_ENV].sort());
  });

  it('asks for the trusted-origin allowlist by the name the gate reads', () => {
    expect(occupant('reviewer', 'hermes_remote_service').hostedOnlyConfig)
      .toEqual([HERMES_TRUSTED_ORIGINS_ENV]);
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
  /**
   * A STALE ENTRY IN THE DISPATCHABLE SET IS INVISIBLE. A typo'd id would be
   * caught incidentally, because every mission would refuse. An id for an
   * occupant that no longer exists — or one added here and never registered —
   * would be caught by nothing at all.
   */
  /**
   * `.env.example` teaches an operator which ids are legal. A registry rename
   * or a fourth occupant leaves that list silently stale, and an operator
   * setting a documented-but-dead id gets `unknown_occupant` for a value the
   * documentation told them to use. The contract list holds the variable
   * NAMES; nothing held the vocabulary until this.
   */
  it('documents exactly the occupant ids an operator may select', () => {
    const env = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    for (const role of ['coding_agent', 'reviewer'] as const) {
      for (const entry of occupantsForRole(role)) {
        expect(env, `${entry.occupantId} is selectable but undocumented`)
          .toContain(entry.occupantId);
      }
    }
  });

  /**
   * TWO FUNCTIONS DECIDE WHAT "live" MEANS, and a comment once claimed they
   * "cannot drift". They are independent literal comparisons. This is the
   * coupling that makes the claim true, and the drift it guards is fail-OPEN:
   * a live mission whose Reviewer was never bound would still run the review
   * leg.
   */
  it('agrees with the mission about which architect mode is live', () => {
    for (const mode of ['live', 'fusion', '', 'LIVE', undefined]) {
      const missionSaysLive = selectArchitectPath({ RELAY_PROMPT_ARCHITECT_MODE: mode }) === 'live';
      const registrySaysLive = architectOccupantFor(mode) === 'openai_gpt_architect';
      expect(registrySaysLive, `disagreement for ${JSON.stringify(mode)}`).toBe(missionSaysLive);
    }
  });

  it('names only registered occupants as dispatchable', () => {
    const registered = new Set(ROLE_OCCUPANTS.map((o) => o.occupantId));
    for (const id of MISSION_DISPATCHABLE_OCCUPANTS) {
      expect(registered, `${id} is dispatchable but not registered`).toContain(id);
    }
  });

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
    expect(resolution.binding.bindings.prompt_architect?.occupant.billingPath).toBe('none');
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
  it.each(['HERMES_LOCAL', 'hermes_locall', 'remote', 'local', '', '   ', ' hermes_local '])(
    'answers %j as unset, invalid, or an occupant — never by silently defaulting',
    (requested) => {
      const resolution = resolveRoleSlotsFromEnv({
        RELAY_PROMPT_ARCHITECT_MODE: 'fusion',
        RELAY_ROLE_REVIEWER: requested,
      });
      const refusals = resolution.binding.ok
        ? []
        : resolution.binding.problems.filter((p) => p.reason === 'invalid_selector');

      /**
       * The vocabulary is the REGISTRY's occupant ids, read from the registry
       * rather than restated here. `local` and `remote` are deliberately in
       * this list: they were the old transport-mode values, and a selector
       * that still accepted them would mean the two surfaces had been merged
       * again. Empty and whitespace are unset, not invalid — an unset slot on
       * a laptop defaults, which is a different answer from a refusal.
       */
      const trimmed = requested.trim();
      const known = occupantsForRole('reviewer').some((o) => o.occupantId === trimmed);
      const expected = trimmed === '' || known ? [] : ['invalid_selector'];
      expect(refusals.map((p) => p.reason)).toEqual(expected);
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

  /**
   * BOUND IS NOT RUNNABLE, AND THE STATUS SIGNAL MUST NOT CONFLATE THEM.
   *
   * This environment binds cleanly: every occupant is registered,
   * hosted-capable and configured. Not one mission can run, because neither
   * the hosted runner nor the remote transport is wired into the mission
   * pipeline. The first version of this test asserted `roleSlotsBound: true`
   * here — the unauthenticated status route announcing staffed roles for a
   * deployment that refuses every mission.
   */
  it('does not report slots as bound when nothing bound can actually be dispatched', async () => {
    await withServer({
      RAILWAY_ENVIRONMENT: 'production',
      RELAY_PROMPT_ARCHITECT_MODE: 'fusion',
      RELAY_ROLE_CODING_AGENT: 'claude_agent_sdk_hosted',
      ANTHROPIC_API_KEY: 'sk-ant-FAKETESTNOTREAL-never-served', // relay-boundary:allow-fixture — synthetic
      RELAY_HOSTED_CODING_MODEL: 'claude-test',
      RELAY_ROLE_REVIEWER: 'hermes_remote_service',
      // SELECTS versus CONFIGURES. `RELAY_ROLE_REVIEWER` names the occupant
      // the mission binds; `RELAY_HERMES_MODE` and the rest configure the
      // transport that occupant needs. Two variables, two jobs.
      RELAY_HERMES_MODE: 'remote',
      RELAY_HERMES_SERVICE_URL: 'https://hermes.internal',
      RELAY_HERMES_SERVICE_TOKEN: 'not-a-real-token',
      RELAY_HERMES_TRUSTED_ORIGINS: 'https://hermes.internal',
    }, (body) => {
      expect(body.roleSlotsBound).toBe(false);
      expect(body.roleSlotRefusals).toEqual([
        'coding_agent:occupant_not_dispatchable',
        'reviewer:occupant_not_dispatchable',
      ]);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('sk-ant-FAKETESTNOTREAL');
      expect(serialized).not.toContain('not-a-real-token');
    });
  }, 30_000);

  it('reports slots bound when every one of them is dispatchable', async () => {
    await withServer({
      RELAY_PROMPT_ARCHITECT_MODE: 'fusion',
      RELAY_ROLE_CODING_AGENT: 'claude_code_local',
      RELAY_ROLE_REVIEWER: 'hermes_local',
    }, (body) => {
      expect(body.roleSlotsBound).toBe(true);
      expect(body.roleSlotRefusals).toEqual([]);
    });
  }, 30_000);
});
