import { isProductionDeployment } from './deployment-environment';
import { createLoopService, type LoopService } from './loop-service';
import { createFakeLoopAgent } from '../src/relay/mission/loop/runtime/fake-loop-agent';

/**
 * WHETHER THIS DEPLOYMENT HAS A LOOP RUN ENGINE, and which one.
 *
 * `main()` passed a literal `null` for the Loop run engine, so every Loop route
 * answered `loop_engine_not_ready` in production. That is a real-wiring
 * violation: the service exists and nothing constructs it.
 *
 * Constructing it unconditionally would be the opposite mistake and the worse
 * one. `createLoopService` needs an agent, and the only agent that exists is
 * the FAKE — the one that simulates an iteration without calling anything. A
 * bridge wired to it would report a ready Loop engine and run simulated
 * iterations under real Loop ids, which is the one thing this product refuses.
 *
 * So the wiring is explicit and fail-closed on both axes:
 *
 *   STATE ROOT   a Loop run is durable or it is not a run. No mounted volume,
 *                no engine — a Loop whose journal disappears on restart is a
 *                worse answer than no Loop.
 *   AGENT        named explicitly by the operator. Absent means none, and the
 *                fake is REFUSED in production regardless of what is set.
 *
 * Every refusal returns a reason, so `/relay-api/health` can say which one
 * rather than reporting an unexplained absence.
 */

export const LOOP_AGENT_ENV = 'RELAY_LOOP_AGENT';

export const LOOP_AGENTS = ['fake'] as const;
export type LoopAgentName = (typeof LOOP_AGENTS)[number];

export const LOOP_COMPOSITION_REFUSALS = [
  'no_state_root',
  'no_agent_named',
  'unknown_agent',
  'simulated_agent_in_production',
] as const;
export type LoopCompositionRefusal = (typeof LOOP_COMPOSITION_REFUSALS)[number];

export type LoopComposition =
  | { readonly wired: true; readonly service: LoopService; readonly agentName: LoopAgentName;
    /** True when iterations are simulated. The surface must say so. */
    readonly simulated: boolean }
  | { readonly wired: false; readonly refusal: LoopCompositionRefusal; readonly detail: string };

export interface LoopCompositionInput {
  readonly stateRoot: string | null;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => string;
  readonly newId: (kind: string) => string;
}

/**
 * Build the Loop run engine, or say precisely why not.
 *
 * The production check is FIRST among the agent rules and cannot be disabled
 * by configuration — the same shape the global spend breaker already uses,
 * for the same reason: an env var that can turn a safety off is a safety that
 * is off.
 */
export function composeLoopRuns(input: LoopCompositionInput): LoopComposition {
  if (input.stateRoot === null || input.stateRoot === '') {
    return {
      wired: false,
      refusal: 'no_state_root',
      detail: 'No durable state root is mounted, and a Loop run whose journal does not survive a restart is not a run.',
    };
  }

  const named = (input.env[LOOP_AGENT_ENV] ?? '').trim();
  if (named === '') {
    return {
      wired: false,
      refusal: 'no_agent_named',
      detail: `No Loop agent is configured. Set ${LOOP_AGENT_ENV} to name one.`,
    };
  }
  if (!(LOOP_AGENTS as readonly string[]).includes(named)) {
    return {
      wired: false,
      refusal: 'unknown_agent',
      detail: `${LOOP_AGENT_ENV}="${named}" names no Loop agent this build ships.`,
    };
  }

  const agentName = named as LoopAgentName;
  const simulated = agentName === 'fake';

  if (simulated && isProductionDeployment(input.env)) {
    // Checked against the ENVIRONMENT, not against a flag, so no configuration
    // can put the simulator in front of a founder's real Loop.
    return {
      wired: false,
      refusal: 'simulated_agent_in_production',
      detail: 'The only Loop agent this build ships simulates its iterations, and a production bridge must not run simulated iterations under real Loop ids.',
    };
  }

  const service = createLoopService({
    root: input.stateRoot,
    /**
     * A SCRIPT THAT ENDS. `createFakeLoopAgent` replays a script and the
     * script is finite on purpose: an infinite simulator would let a
     * development bridge iterate until it hit a budget, which teaches nothing
     * and burns a durable journal doing it. It reports progress and then
     * offers evidence Relay itself can see, which is the shape a real agent
     * has.
     */
    agent: createFakeLoopAgent([
      { kind: 'continuing' },
      { kind: 'observed_evidence' },
    ]),
    now: input.now,
    newId: input.newId,
  });

  return { wired: true, service, agentName, simulated };
}

/** A short code for the health surface. Never a path, never a variable value. */
export function loopCompositionCode(composition: LoopComposition): string {
  return composition.wired
    ? (composition.simulated ? 'wired_simulated' : 'wired')
    : composition.refusal;
}
