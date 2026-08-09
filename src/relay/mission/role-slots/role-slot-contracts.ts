/**
 * ROLE SLOTS — the permanent roles, and what may occupy them.
 *
 * Relay's three roles are FIXED: a Prompt Architect writes the brief, a Coding
 * Agent implements it, and an independent Reviewer decides whether the result
 * may be released. Those three are the product. What is NOT fixed is which
 * model, agent or harness stands in each slot — and until now that choice was
 * spread across a `claudeMode` string, a Hermes transport mode, an architect
 * mode, and a hard-coded pair of identity literals in the attestation builder.
 *
 * THE DEFECT THIS EXISTS TO REMOVE. `coding.ts` built every Coding Agent
 * attestation with `requestedActor: 'Claude Code'` and
 * `actualActor: 'Claude Code'` written as literals, and `billingPath:
 * 'subscription'` beside them. While exactly one runtime could ever occupy the
 * slot those literals were merely redundant. The moment a second one can, they
 * are false — a hosted Agent-SDK run is API-billed, and an attestation that
 * says `subscription` misreports who paid. Requested and actual are separate
 * fields precisely so that a swap is visible; hard-coding both to the same
 * literal is how a swap becomes invisible. The REQUESTED half now comes from
 * the bound occupant; the ACTUAL half stays observed, which is the whole point.
 *
 * REGISTERED IS NOT DISPATCHABLE, AND THE DIFFERENCE IS LOAD-BEARING. This
 * registry says what Relay has an adapter for. Whether a PARTICULAR pipeline
 * can drive that adapter is a separate fact owned by that pipeline, and
 * conflating the two produced a real defect in the first version of this
 * module: binding accepted `claude_agent_sdk_hosted`, the preflight event
 * announced "Coding Agent: Claude Agent SDK (hosted)", and the Claude Code CLI
 * then ran and attested itself — the mission narrating one occupant while
 * another did the work. A dispatcher must refuse an occupant it cannot drive;
 * see `missionDispatchProblems` in the bridge, which owns dispatch.
 *
 * WHAT A SLOT BINDING IS, AND IS NOT. Binding resolves what a deployment
 * REQUESTED and proves the request is coherent — a registered occupant, for
 * the right role, with an adapter, able to run in this environment, with its
 * configuration present. It is not evidence that anything ran, and it never
 * becomes the `actual` half of an attestation. Actual identity comes from the
 * runtime's own response, after the fact, and from nowhere else.
 *
 * PURE DOMAIN. No Node, no network, no clock. The browser, the CLI and the
 * bridge all read the same registry and reach the same conclusions.
 */

/** The three permanent roles. Adding a fourth is a product decision, not a
 *  configuration one, which is why this list is frozen and not derived. */
export const ROLE_SLOTS = ['prompt_architect', 'coding_agent', 'reviewer'] as const;
export type RoleSlot = (typeof ROLE_SLOTS)[number];

/**
 * How an occupant is reached. This is a MECHANISM, not a quality claim: it
 * says what Relay must do to run it, which is what decides whether a given
 * deployment can.
 */
export const OCCUPANT_KINDS = [
  /** A command-line agent Relay spawns on the machine it is running on. */
  'agent_cli',
  /** An agent library Relay loads in-process against a server credential. */
  'agent_sdk',
  /** A review harness Relay spawns locally. */
  'harness_local',
  /** A review harness Relay calls over authenticated HTTP. */
  'harness_remote',
  /** A provider API Relay calls directly. */
  'provider_api',
  /** A development engine that makes no provider call at all. */
  'development_engine',
] as const;
export type OccupantKind = (typeof OCCUPANT_KINDS)[number];

/**
 * WHERE AN OCCUPANT CAN RUN, and the reason this distinction earns a type.
 *
 * A Coding Agent that is an installed CLI can only run where that CLI is
 * installed. On Railway it never will be — and the honest answer is not "not
 * ready yet" but "never, on this host". Reporting the second as the first is
 * what once told a founder to install Hermes on a Chromebook to fix a
 * container. An environment is therefore a property of the OCCUPANT, checked
 * against the deployment, rather than something a probe rediscovers each time.
 */
export const EXECUTION_ENVIRONMENTS = ['founder_machine', 'hosted'] as const;
export type ExecutionEnvironment = (typeof EXECUTION_ENVIRONMENTS)[number];

/** Who pays, when this occupant runs. `unknown` stays unknown. */
export const BILLING_PATHS = ['subscription', 'api', 'none', 'unknown'] as const;
export type BillingPath = (typeof BILLING_PATHS)[number];

/**
 * A registered occupant: something that may stand in a role slot.
 *
 * The three identity fields at the top are not decoration. They are the exact
 * inputs `reviewerIsIndependent` already consumes, carried here so that
 * independence is computed by Relay's ONE existing rule rather than by a
 * second one invented alongside this registry.
 */
export interface RoleOccupant {
  readonly occupantId: string;
  readonly role: RoleSlot;
  /** Identity of the agent itself, as the independence rule understands it. */
  readonly agentId: string;
  /** Identity of the Relay adapter that drives it. */
  readonly adapterId: string;
  /**
   * The independence group. Two occupants in the same group are NOT
   * independent of each other, whatever else differs — this is the field that
   * stops "same vendor, different model" from passing as an independent
   * review.
   */
  readonly independenceGroup: string;
  readonly displayName: string;
  readonly kind: OccupantKind;
  readonly environments: readonly ExecutionEnvironment[];
  /** Whether Relay ships a concrete adapter for it AT ALL. A registry entry
   *  is a product definition; an adapter is a fact about this build. */
  readonly adapterAvailable: boolean;
  readonly billingPath: BillingPath;
  /**
   * Environment variable NAMES this occupant needs. Names only — no value is
   * ever read, compared or carried by this module, so a registry entry can be
   * rendered to a browser without redaction.
   */
  readonly requiredConfig: readonly string[];
  /**
   * Names required only on a HOSTED deployment.
   *
   * Some gates are armed by production and deliberately relaxed elsewhere —
   * the Hermes trusted-origin allowlist is required on a server and not on a
   * laptop pointing at loopback. Demanding those names everywhere would refuse
   * a setup the gate itself permits; omitting them entirely lets a hosted
   * deployment bind and then fail its own transport selection.
   */
  readonly hostedOnlyConfig?: readonly string[];
  /** What is NOT proven about this occupant. Written down so a surface cannot
   *  present a registry entry as a capability guarantee. */
  readonly verificationNotes: readonly string[];
}

/**
 * Why a requested binding was refused.
 *
 * Every one of these is a REFUSAL, not an outage: each names something an
 * operator changes, and none of them clears on its own. They stay separate
 * because the remedies differ — `environment_unsupported` means pick a
 * different occupant, while `configuration_missing` means set a variable and
 * keep the one you picked.
 */
export const ROLE_BINDING_REFUSALS = [
  'no_occupant_requested',
  /**
   * A selector was set to something that is not a valid choice.
   *
   * Separate from `no_occupant_requested` because the remedies are opposite:
   * one says set the variable, the other says the variable you set is
   * misspelled. Collapsing them told an operator "no occupant is configured"
   * for `RELAY_HERMES_MODE=romote`, which is configured, and wrong.
   */
  'invalid_selector',
  'unknown_occupant',
  'occupant_role_mismatch',
  'adapter_unavailable',
  'environment_unsupported',
  'configuration_missing',
  'reviewer_not_independent',
  /**
   * Registered, coherent, configured — and this pipeline cannot drive it.
   *
   * The refusal that stops a mission narrating one occupant while another does
   * the work. Registration is a fact about Relay; dispatchability is a fact
   * about the caller, and only the caller knows it.
   */
  'occupant_not_dispatchable',
] as const;
export type RoleBindingRefusal = (typeof ROLE_BINDING_REFUSALS)[number];

export interface RoleBindingProblem {
  readonly role: RoleSlot;
  readonly reason: RoleBindingRefusal;
  /** Safe to show an operator: names roles, occupants and variable NAMES. */
  readonly safeMessage: string;
}

/**
 * A resolved slot. `requestedOccupantId` is what the deployment asked for and
 * is the only thing this record asserts — the occupant that ANSWERS is
 * observed later, by the runtime, and is never copied from here.
 */
export interface RoleBinding {
  readonly role: RoleSlot;
  readonly requestedOccupantId: string;
  readonly occupant: RoleOccupant;
}

export type RoleSlotBindingResult =
  | { readonly ok: true; readonly bindings: Readonly<Record<RoleSlot, RoleBinding>> }
  | { readonly ok: false; readonly problems: readonly RoleBindingProblem[] };
