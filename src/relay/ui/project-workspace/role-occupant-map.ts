import { findOccupant, type RoleOccupant, type RoleSlot } from '../../mission';
import type { AgentOption } from '../project-settings';

/**
 * JOINING WHAT A PROJECT CAN SELECT TO WHAT RELAY CAN ACTUALLY DISPATCH.
 *
 * Two lists exist in this repository and both are real:
 *
 *   AGENT_OPTIONS      the project's configuration vocabulary. Project
 *                      Settings writes these ids into the project's workforce
 *                      selection, and `configured-start` reads them back.
 *   ROLE_OCCUPANTS     the mission registry the bridge BINDS against. An
 *                      occupant is something Relay ships an adapter for and
 *                      can name in a role slot.
 *
 * They answer different questions — "what may this project choose" and "what
 * can this deployment run" — so neither replaces the other, and this module
 * does not invent a third. It is only the join, and the join is what makes an
 * availability label checkable instead of a claim in a data file.
 *
 * WHY A HAND-WRITTEN TABLE. The two vocabularies were written independently
 * and there is no derivable rule between `coding-claude-code` and
 * `claude_code_local`. A guessed match is exactly the failure the occupant
 * registry exists to prevent, so every pair here is stated once, and
 * `role-occupant-map.test.ts` fails if either side names something the other
 * does not have.
 */

/**
 * Catalog option id → the occupants that can actually run it.
 *
 * An option ABSENT from this table, or present with an empty list, has no
 * registered occupant: a mission that names it is refused at binding rather
 * than dispatched. That is a fact worth showing, not hiding.
 */
export const OCCUPANTS_FOR_AGENT_OPTION: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    'architect-sunday-alcatraz': Object.freeze(['fusion_architect']),
    'architect-gpt': Object.freeze(['openai_gpt_architect']),
    'coding-claude-code': Object.freeze(['claude_code_local', 'claude_agent_sdk_hosted']),
    'reviewer-hermes': Object.freeze(['hermes_local', 'hermes_remote_service']),
  });

/**
 * `claude_code_fake` is registered and deliberately UNMAPPED.
 *
 * It is the offline no-spend engine, chosen by a server variable so a
 * deployment can exercise the coding leg without buying tokens. A founder
 * picking "Claude Code" in a project must never quietly get it — that would be
 * a simulated run wearing a real name, which is the one thing this product
 * refuses. It is reachable only where it is honest: the server.
 */
export const UNMAPPED_OCCUPANTS: readonly string[] = Object.freeze(['claude_code_fake']);

/**
 * Which machine a workspace is actually talking to.
 *
 * `null` is a real answer and not a default: a browser with no Relay bridge
 * connected cannot say where anything would run, and answering
 * "founder machine" would be a guess about a computer it has never seen.
 */
export type DeploymentKind = 'hosted' | 'founder_machine' | null;

export interface AgentOptionDispatch {
  /** Registered occupants for this option, in registry order. */
  readonly occupants: readonly RoleOccupant[];
  /**
   * Whether any occupant can run on the deployment being asked about.
   * `null` when there is no deployment to ask about — unknown is not false.
   */
  readonly runsHere: boolean | null;
  /**
   * Server-side names this choice reads before it can run here.
   *
   * NAMES, never values — naming what to set is the point of the disclosure,
   * and a value would be a credential in a browser. Empty means the occupant
   * that runs here needs nothing, not that configuration is unknown.
   */
  readonly requiredConfig: readonly string[];
}

/**
 * What the registry knows about one catalog option.
 *
 * `deployment` is an INPUT. A browser cannot tell a container from a laptop,
 * and an occupant that only runs on one of them is the difference between "not
 * set up yet" and "never, on this machine" — so the caller supplies it rather
 * than this module guessing.
 */
export function dispatchForAgentOption(
  option: AgentOption,
  role: RoleSlot,
  deployment: DeploymentKind,
): AgentOptionDispatch {
  const ids = OCCUPANTS_FOR_AGENT_OPTION[option.id] ?? [];
  const occupants = ids
    .map((id) => findOccupant(role, id))
    .filter((o): o is RoleOccupant => o !== null);

  if (deployment === null) {
    return { occupants, runsHere: null, requiredConfig: Object.freeze([]) };
  }

  const hosted = deployment === 'hosted';
  const here = occupants.filter(
    (o) => o.adapterAvailable && o.environments.includes(deployment),
  );

  // The LEAST configuration any occupant that runs here needs. Two occupants
  // can hold the same option — a CLI and a hosted SDK — and reporting the
  // union would demand variables the deployment will never read.
  const cheapest = here
    .map((o) => [...o.requiredConfig, ...(hosted ? o.hostedOnlyConfig ?? [] : [])])
    .sort((a, b) => a.length - b.length)[0] ?? [];

  return {
    occupants,
    runsHere: here.length > 0,
    requiredConfig: Object.freeze([...cheapest]),
  };
}
