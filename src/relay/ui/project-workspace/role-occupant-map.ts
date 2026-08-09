import type { ExecutionEnvironment, RoleSlot } from '../../mission';
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
 * WHY THIS DOES NOT IMPORT THE REGISTRY.
 *
 * Occupants carry the server-side variable names their adapters read — a
 * provider API key among them. Importing the registry here put those names
 * into the browser's import graph and therefore into its bundle, which
 * `connectors/gpt-architect/browser-isolation.test.ts` caught by walking the
 * real graph from `main.tsx`. A variable name is not a secret; publishing the
 * server's configuration surface to a client that has no business knowing it
 * is still a boundary this repository decided, and the repair belongs at the
 * class rather than the instance — so NO configuration name appears here at
 * all, for any provider, now or later.
 *
 * What survives is what the browser can honestly use: which occupants exist,
 * where they run, and WHETHER they read server configuration. Which variables
 * those are is a server answer, and the bridge's readiness output and the
 * Founder Testing Handoff are where it is given.
 *
 * Both tables below are hand-written for the same reason: the two vocabularies
 * were written independently and there is no derivable rule between
 * `coding-claude-code` and `claude_code_local`. `role-occupant-map.test.ts`
 * imports the real registry — a test is not in the browser's graph — and fails
 * if either table drifts from it.
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
 * What the browser may know about an occupant.
 *
 * Deliberately NOT the occupant record: no `requiredConfig`, no
 * `hostedOnlyConfig`, no variable name of any kind. `needsServerConfig` says
 * that configuration exists and is read elsewhere — which is the part a
 * founder can act on from here.
 */
export interface OccupantFacts {
  readonly occupantId: string;
  readonly role: RoleSlot;
  readonly displayName: string;
  readonly environments: readonly ExecutionEnvironment[];
  readonly adapterAvailable: boolean;
  /** Whether this occupant reads server configuration, per deployment kind. */
  readonly needsServerConfig: Readonly<Record<ExecutionEnvironment, boolean>>;
}

const NO_CONFIG: Readonly<Record<ExecutionEnvironment, boolean>> =
  Object.freeze({ founder_machine: false, hosted: false });
const CONFIG_EITHER_WAY: Readonly<Record<ExecutionEnvironment, boolean>> =
  Object.freeze({ founder_machine: true, hosted: true });

export const OCCUPANT_FACTS: readonly OccupantFacts[] = Object.freeze([
  Object.freeze({
    occupantId: 'openai_gpt_architect',
    role: 'prompt_architect',
    displayName: 'ChatGPT (OpenAI) Prompt Architect',
    environments: Object.freeze(['founder_machine', 'hosted']),
    adapterAvailable: true,
    needsServerConfig: CONFIG_EITHER_WAY,
  }),
  Object.freeze({
    occupantId: 'fusion_architect',
    role: 'prompt_architect',
    displayName: 'Sunday Alcatraz (Fusion) development architect',
    environments: Object.freeze(['founder_machine', 'hosted']),
    adapterAvailable: true,
    needsServerConfig: NO_CONFIG,
  }),
  Object.freeze({
    occupantId: 'claude_code_local',
    role: 'coding_agent',
    displayName: 'Claude Code (installed CLI)',
    environments: Object.freeze(['founder_machine']),
    adapterAvailable: true,
    needsServerConfig: NO_CONFIG,
  }),
  Object.freeze({
    occupantId: 'claude_agent_sdk_hosted',
    role: 'coding_agent',
    displayName: 'Claude Agent SDK (hosted)',
    environments: Object.freeze(['founder_machine', 'hosted']),
    adapterAvailable: true,
    needsServerConfig: CONFIG_EITHER_WAY,
  }),
  Object.freeze({
    occupantId: 'claude_code_fake',
    role: 'coding_agent',
    displayName: 'Relay fake Claude Code (offline, no spend)',
    environments: Object.freeze(['founder_machine', 'hosted']),
    adapterAvailable: true,
    needsServerConfig: NO_CONFIG,
  }),
  Object.freeze({
    occupantId: 'hermes_local',
    role: 'reviewer',
    displayName: 'Hermes Reviewer (local process)',
    environments: Object.freeze(['founder_machine']),
    adapterAvailable: true,
    needsServerConfig: NO_CONFIG,
  }),
  Object.freeze({
    occupantId: 'hermes_remote_service',
    role: 'reviewer',
    displayName: 'Hermes Reviewer (dedicated service)',
    environments: Object.freeze(['founder_machine', 'hosted']),
    adapterAvailable: true,
    // The remote transport reads a service URL and a token, and a production
    // bridge additionally reads a trusted-origins list. That both are true is
    // said here; which variables they are is not.
    needsServerConfig: CONFIG_EITHER_WAY,
  }),
] as OccupantFacts[]);

export function occupantFacts(occupantId: string): OccupantFacts | null {
  return OCCUPANT_FACTS.find((o) => o.occupantId === occupantId) ?? null;
}

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
  readonly occupants: readonly OccupantFacts[];
  /**
   * Whether any occupant can run on the deployment being asked about.
   * `null` when there is no deployment to ask about — unknown is not false.
   */
  readonly runsHere: boolean | null;
  /**
   * Whether the occupant that would run here reads server configuration.
   *
   * A BOOLEAN, never a list of names. `false` means the occupant that would
   * run needs nothing; `null` means there is no deployment to answer for.
   */
  readonly needsServerConfig: boolean | null;
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
    .map((id) => occupantFacts(id))
    .filter((o): o is OccupantFacts => o !== null && o.role === role);

  if (deployment === null) {
    return { occupants, runsHere: null, needsServerConfig: null };
  }

  const here = occupants.filter(
    (o) => o.adapterAvailable && o.environments.includes(deployment),
  );

  // The LEAST configuration any occupant that runs here demands. Two occupants
  // can hold the same option — a CLI and a hosted SDK — and answering for the
  // stricter one would report configuration this deployment never reads.
  return {
    occupants,
    runsHere: here.length > 0,
    needsServerConfig: here.length > 0 && here.every((o) => o.needsServerConfig[deployment]),
  };
}
