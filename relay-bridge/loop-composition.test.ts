import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  LOOP_AGENT_ENV,
  composeLoopRuns,
  loopCompositionCode,
} from './loop-composition';

/**
 * WHETHER THIS BRIDGE HAS A LOOP RUN ENGINE.
 *
 * `main()` passed a literal `null`, so every Loop route answered
 * `loop_engine_not_ready` while the service sat unconstructed — a real-wiring
 * violation.
 *
 * Constructing it unconditionally would be worse. The only agent this build
 * ships SIMULATES its iterations, and a production bridge running simulated
 * iterations under real Loop ids is the failure this product exists to
 * prevent. So both axes fail closed, and the production refusal cannot be
 * turned off by configuration.
 */

const roots: string[] = [];
const root = (): string => {
  const created = mkdtempSync(join(tmpdir(), 'relay-loop-comp-'));
  roots.push(created);
  return created;
};
afterAll(() => {
  for (const created of roots) rmSync(created, { recursive: true, force: true });
});

const deps = {
  now: () => '2026-08-10T12:00:00.000Z',
  newId: (kind: string) => `${kind}-1`,
};

describe('durability first', () => {
  it('refuses to wire without a mounted state root', () => {
    for (const stateRoot of [null, '']) {
      const composition = composeLoopRuns({
        stateRoot, env: { [LOOP_AGENT_ENV]: 'fake' }, ...deps,
      });
      expect(composition.wired, String(stateRoot)).toBe(false);
      if (!composition.wired) {
        expect(composition.refusal).toBe('no_state_root');
        // The reason names the actual problem: a Loop whose journal vanishes
        // on restart is not a Loop that ran.
        expect(composition.detail).toContain('survive a restart');
      }
    }
  });
});

describe('the agent is named, never assumed', () => {
  it('refuses when nothing is configured', () => {
    const composition = composeLoopRuns({ stateRoot: root(), env: {}, ...deps });
    expect(composition.wired).toBe(false);
    if (!composition.wired) {
      expect(composition.refusal).toBe('no_agent_named');
      expect(composition.detail).toContain(LOOP_AGENT_ENV);
    }
  });

  it('refuses a name this build does not ship', () => {
    const composition = composeLoopRuns({
      stateRoot: root(), env: { [LOOP_AGENT_ENV]: 'claude-loop' }, ...deps,
    });
    expect(composition.wired).toBe(false);
    if (!composition.wired) expect(composition.refusal).toBe('unknown_agent');
  });

  it('treats whitespace as absent rather than as a name', () => {
    const composition = composeLoopRuns({
      stateRoot: root(), env: { [LOOP_AGENT_ENV]: '   ' }, ...deps,
    });
    if (!composition.wired) expect(composition.refusal).toBe('no_agent_named');
    else throw new Error('whitespace was accepted as an agent name');
  });
});

describe('the simulator never runs in production', () => {
  const productionEnvs: NodeJS.ProcessEnv[] = [
    { NODE_ENV: 'production' },
    { RAILWAY_ENVIRONMENT: 'production' },
  ];

  it('refuses the fake agent on a production deployment', () => {
    for (const env of productionEnvs) {
      const composition = composeLoopRuns({
        stateRoot: root(), env: { ...env, [LOOP_AGENT_ENV]: 'fake' }, ...deps,
      });
      expect(composition.wired, JSON.stringify(env)).toBe(false);
      if (!composition.wired) {
        expect(composition.refusal).toBe('simulated_agent_in_production');
        expect(composition.detail).toContain('simulated iterations under real Loop ids');
      }
    }
  });

  it('cannot be overridden by any configuration', () => {
    // The shape the global spend breaker already uses, for the same reason: an
    // env var that can turn a safety off is a safety that is off.
    const composition = composeLoopRuns({
      stateRoot: root(),
      env: {
        NODE_ENV: 'production',
        [LOOP_AGENT_ENV]: 'fake',
        RELAY_LOOP_ALLOW_SIMULATED: '1',
        RELAY_LOOP_FORCE: 'true',
        RELAY_ALLOW_FAKE: 'yes',
      },
      ...deps,
    });
    expect(composition.wired).toBe(false);
  });
});

describe('when it does wire', () => {
  it('builds the service and SAYS the iterations are simulated', () => {
    const composition = composeLoopRuns({
      stateRoot: root(), env: { [LOOP_AGENT_ENV]: 'fake' }, ...deps,
    });
    expect(composition.wired).toBe(true);
    if (!composition.wired) throw new Error(composition.detail);
    expect(composition.agentName).toBe('fake');
    // Simulated data says so. A surface reading this must repeat it.
    expect(composition.simulated).toBe(true);
    expect(typeof composition.service.confirm).toBe('function');
  });
});

describe('the health code', () => {
  it('distinguishes wired-simulated from wired, and names each refusal', () => {
    const wired = composeLoopRuns({
      stateRoot: root(), env: { [LOOP_AGENT_ENV]: 'fake' }, ...deps,
    });
    expect(loopCompositionCode(wired)).toBe('wired_simulated');

    const noRoot = composeLoopRuns({ stateRoot: null, env: {}, ...deps });
    expect(loopCompositionCode(noRoot)).toBe('no_state_root');

    const noAgent = composeLoopRuns({ stateRoot: root(), env: {}, ...deps });
    expect(loopCompositionCode(noAgent)).toBe('no_agent_named');
  });

  it('is a code, never a path or a variable value', () => {
    const stateRoot = root();
    const composition = composeLoopRuns({
      stateRoot, env: { [LOOP_AGENT_ENV]: 'claude-loop' }, ...deps,
    });
    const code = loopCompositionCode(composition);
    // `/relay-api/health` is unauthenticated. A code discloses that something
    // is unset; a path discloses the host's layout.
    expect(code).not.toContain(stateRoot);
    expect(code).not.toContain('claude-loop');
    expect(code).toMatch(/^[a-z_]+$/);
  });
});
