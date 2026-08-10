import {
  ROLE_SLOTS,
  type RoleOccupant, type RoleSlot,
} from './role-slot-contracts';

/**
 * THE REGISTERED OCCUPANTS.
 *
 * One entry per thing that may stand in a role slot. An entry is a PRODUCT
 * DEFINITION and never evidence: it says Relay ships an adapter and what that
 * adapter needs, not that the adapter is configured here, not that a
 * credential is valid, and not that anything has ever run. Those are separate
 * facts with separate fields elsewhere, for the same reason the Reviewer
 * harness catalog keeps them apart — a list that reads like a feature set is
 * the failure mode both are designed against.
 *
 * INDEPENDENCE GROUPS ARE VENDOR-SHAPED, ON PURPOSE. Both Coding Agent
 * occupants are Anthropic-backed and therefore share one group, so a future
 * Anthropic-backed Reviewer would be refused as non-independent even though
 * its model, adapter and agent id all differ. That is the intended answer.
 * "Same vendor, different model" is exactly the review that looks independent
 * and is not, and the group field is the only thing in the identity set that
 * catches it.
 *
 * ENVIRONMENTS ARE A PROPERTY OF THE OCCUPANT. `claude_code_local` names a CLI
 * that must be installed on the machine Relay runs on; on a container it never
 * will be. Saying so here means a hosted deployment refuses it up front with
 * "this occupant cannot run on this host" instead of probing, failing, and
 * telling a founder to install something on a machine that is not the one with
 * the problem.
 */

/**
 * Environment variable names, declared here because THIS module is the
 * authority on what an occupant needs. `relay-bridge/role-slots-parity.test.ts`
 * holds these against the bridge's own constants so the two cannot drift.
 *
 * UNDER-DECLARING IS AS BAD AS OVER-DECLARING. A missing name makes binding
 * report "configuration present" for an occupant that a probe one layer later
 * refuses — a refusal arriving too late to be useful, which is the exact thing
 * binding-before-spend exists to prevent. Two names were missing in the first
 * version: `RELAY_HOSTED_CODING_MODEL`, which `probeHostedReadiness` refuses
 * without because Relay will not choose a model on the operator's behalf, and
 * `RELAY_HERMES_TRUSTED_ORIGINS`, without which a PRODUCTION bridge sends its
 * bearer token nowhere.
 */
const OPENAI_ARCHITECT_CONFIG = Object.freeze([
  'RELAY_PROMPT_ARCHITECT_MODE',
  'OPENAI_API_KEY',
  'OPENAI_PROMPT_ARCHITECT_MODEL',
]);
const HOSTED_CODING_CONFIG = Object.freeze([
  'ANTHROPIC_API_KEY',
  'RELAY_HOSTED_CODING_MODEL',
]);
/**
 * What the GPT Reviewer reads. The mode is separate from the architect's on
 * purpose: one credential, two roles, and turning on the second must be its
 * own decision because it is its own bill.
 */
const OPENAI_REVIEWER_CONFIG = Object.freeze([
  'RELAY_OPENAI_REVIEWER_MODE',
  'OPENAI_API_KEY',
  'RELAY_OPENAI_REVIEWER_MODEL',
]);

const HERMES_REMOTE_CONFIG = Object.freeze([
  'RELAY_HERMES_MODE',
  'RELAY_HERMES_SERVICE_URL',
  'RELAY_HERMES_SERVICE_TOKEN',
]);
/**
 * WHAT `hostedOnlyConfig` HERE ACTUALLY MEANS, corrected.
 *
 * The first version said "required only where the trusted-origin gate is
 * armed, which is production". The gate is armed EVERYWHERE — outside
 * production it merely ALSO accepts a loopback origin. So a laptop pointing at
 * a non-loopback Hermes service binds here and is refused by
 * `checkServiceUrl`, which is the very "refusal one layer too late" this field
 * was added to prevent, narrowed rather than removed.
 *
 * The honest condition is loopback-ness of the service URL, and this module
 * cannot evaluate it: it sees variable NAMES, never values, deliberately. So
 * the field stays hosted-scoped — where the answer is unambiguous, because
 * loopback is never right for a hosted service — and the laptop case is stated
 * as a known limit rather than claimed as covered.
 */
const HERMES_REMOTE_PRODUCTION_CONFIG = Object.freeze([
  'RELAY_HERMES_TRUSTED_ORIGINS',
]);

export const ROLE_OCCUPANTS: readonly RoleOccupant[] = Object.freeze([
  /* ------------------------------------------------- prompt architect --- */
  {
    occupantId: 'openai_gpt_architect',
    actorName: 'ChatGPT',
    role: 'prompt_architect',
    agentId: 'openai-prompt-architect',
    adapterId: 'openai-architect',
    independenceGroup: 'openai-gpt',
    displayName: 'ChatGPT (OpenAI) Prompt Architect',
    kind: 'provider_api',
    environments: ['founder_machine', 'hosted'],
    adapterAvailable: true,
    billingPath: 'api',
    requiredConfig: OPENAI_ARCHITECT_CONFIG,
    verificationNotes: [
      'A credential VARIABLE being set is never proof the key is valid; only a call proves that.',
      'Live is enabled by RELAY_PROMPT_ARCHITECT_MODE=live and never inferred from a key being present.',
    ],
  },
  {
    occupantId: 'fusion_architect',
    actorName: 'Sunday Alcatraz',
    role: 'prompt_architect',
    agentId: 'fusion-architect',
    adapterId: 'fusion-architect',
    independenceGroup: 'sunday-fusion',
    displayName: 'Sunday Alcatraz (Fusion) development architect',
    kind: 'development_engine',
    environments: ['founder_machine', 'hosted'],
    adapterAvailable: true,
    billingPath: 'none',
    requiredConfig: Object.freeze([]),
    verificationNotes: [
      'A development path. This is not the live Prompt Architect and must never be presented as one.',
    ],
  },

  /* ----------------------------------------------------- coding agent --- */
  {
    occupantId: 'claude_code_local',
    actorName: 'Claude Code',
    role: 'coding_agent',
    agentId: 'claude-code',
    // Matches `CLAUDE_ADAPTER_ID` / `LOCAL_ADAPTER_ID`, held by a test.
    adapterId: 'claude-code-local',
    independenceGroup: 'anthropic-claude',
    displayName: 'Claude Code (installed CLI)',
    kind: 'agent_cli',
    // An installed CLI, and only where it is installed. A container is not
    // "not ready yet" for this occupant; it is permanently the wrong host.
    environments: ['founder_machine'],
    adapterAvailable: true,
    // The approved auth profile is the founder's own subscription login. Relay
    // strips API-billing variables by name, so this path cannot become `api`.
    billingPath: 'subscription',
    requiredConfig: Object.freeze([]),
    verificationNotes: [
      'Requires the Claude Code CLI installed on the machine running Relay, logged in to a first-party subscription.',
      'An API-key auth source raises a Manual Task rather than an API-billed run.',
    ],
  },
  {
    occupantId: 'claude_agent_sdk_hosted',
    actorName: 'Claude Agent SDK',
    role: 'coding_agent',
    agentId: 'claude-agent-sdk',
    // Matches `HOSTED_ADAPTER_ID`, held by a test.
    adapterId: 'claude-agent-sdk-hosted',
    // Same vendor as the local CLI, so the same group. See the header.
    independenceGroup: 'anthropic-claude',
    displayName: 'Claude Agent SDK (hosted)',
    kind: 'agent_sdk',
    environments: ['founder_machine', 'hosted'],
    adapterAvailable: true,
    // API-billed, and the reason `billingPath` could not stay a literal.
    billingPath: 'api',
    requiredConfig: HOSTED_CODING_CONFIG,
    verificationNotes: [
      'The SDK extracts a platform-native runtime at run time, so the package must be installed in the deployment.',
      'A credential VARIABLE being set is never proof the key is valid; only a run proves that.',
    ],
  },

  {
    /**
     * THE KEYLESS OFFLINE PIPELINE, AS AN OCCUPANT.
     *
     * `RELAY_BRIDGE_FAKE_CLAUDE=1` is a documented capability — a whole
     * mission with no credential and no spend, driven by the repo's own fake
     * executable. Modelling it as a MODE of `claude_code_local` broke it on a
     * hosted deployment: that occupant declares `founder_machine` because it
     * needs an installed CLI, and the fake needs no CLI at all. A synthetic
     * runtime that spends nothing and runs anywhere is a different occupant,
     * and saying so is what this registry is for.
     *
     * It drives the same ADAPTER, so `adapterId` matches — `surfaceForAdapter`
     * is right that the work went through the local Claude Code surface. What
     * differs is who was asked for, what it costs, and where it can run.
     */
    occupantId: 'claude_code_fake',
    // What the fake executable reports being. `actorMatches` compares this
    // with the adapter's own label, so it is the adapter's vocabulary.
    actorName: 'Claude Code',
    role: 'coding_agent',
    agentId: 'claude-code-fake',
    adapterId: 'claude-code-local',
    independenceGroup: 'anthropic-claude',
    displayName: 'Relay fake Claude Code (offline, no spend)',
    kind: 'development_engine',
    environments: ['founder_machine', 'hosted'],
    adapterAvailable: true,
    // Nothing is spent, and the attestation says `simulated` rather than
    // inventing a payer.
    billingPath: 'none',
    requiredConfig: Object.freeze([]),
    verificationNotes: [
      'A development path. No provider is contacted and no credential is read; it must never be presented as a real run.',
      'Selected by RELAY_BRIDGE_FAKE_CLAUDE=1, which is a deployment mode rather than a role choice.',
      'Needs git and node on the host: it builds a throwaway fixture repository and runs the tests itself. Those are process requirements this registry cannot probe, so they are named here rather than claimed absent.',
    ],
  },

  /* --------------------------------------------------------- reviewer --- */
  {
    /**
     * A REVIEWER A HOSTED BRIDGE CAN ACTUALLY HAVE.
     *
     * The other two are each blocked on something outside the code: the local
     * one needs Hermes on the PATH, which a container never has, and the
     * remote one needs a service that is not deployed. This one needs a
     * provider credential that production already holds for the Prompt
     * Architect.
     *
     * `openai-gpt` is deliberately THE SAME independence group the OpenAI
     * architect carries. Independence is measured against the CODING AGENT and
     * this reviewer is independent of an Anthropic one — but a deployment that
     * ever ran an OpenAI coding agent must be refused this Reviewer, and
     * sharing the group is what makes that refusal automatic rather than
     * remembered.
     */
    occupantId: 'openai_reviewer',
    actorName: 'GPT',
    role: 'reviewer',
    agentId: 'openai',
    adapterId: 'openai',
    independenceGroup: 'openai-gpt',
    displayName: 'GPT Reviewer (provider API)',
    kind: 'provider_api',
    environments: ['founder_machine', 'hosted'],
    adapterAvailable: true,
    billingPath: 'api',
    requiredConfig: OPENAI_REVIEWER_CONFIG,
    verificationNotes: [
      'Enabled explicitly: the credential already exists for the Prompt Architect, and using it for a second PAID role is an operator decision rather than a default.',
      'Readiness is configuration presence only. Whether the provider answers is proven by the first review, because a probe that proved it would be a paid call.',
    ],
  },
  {
    occupantId: 'hermes_local',
    actorName: 'Hermes',
    role: 'reviewer',
    agentId: 'hermes',
    adapterId: 'hermes',
    independenceGroup: 'hermes-xai',
    displayName: 'Hermes Reviewer (local process)',
    kind: 'harness_local',
    environments: ['founder_machine'],
    adapterAvailable: true,
    billingPath: 'api',
    requiredConfig: Object.freeze([]),
    verificationNotes: [
      'Requires the Hermes executable on the PATH of the machine running Relay.',
      'Read-only is structural: an isolated profile leaves the model with no toolset at all.',
    ],
  },
  {
    occupantId: 'hermes_remote_service',
    actorName: 'Hermes',
    role: 'reviewer',
    agentId: 'hermes',
    adapterId: 'hermes',
    independenceGroup: 'hermes-xai',
    displayName: 'Hermes Reviewer (dedicated service)',
    kind: 'harness_remote',
    // The whole point of the remote transport: a bridge that will never have
    // the binary can still reach a Reviewer.
    environments: ['founder_machine', 'hosted'],
    adapterAvailable: true,
    billingPath: 'api',
    requiredConfig: HERMES_REMOTE_CONFIG,
    hostedOnlyConfig: HERMES_REMOTE_PRODUCTION_CONFIG,
    verificationNotes: [
      'A production bridge must additionally list the service origin in RELAY_HERMES_TRUSTED_ORIGINS; the bearer token goes nowhere else.',
      'Configuration proves the bridge is set up to reach a service, never that one answered.',
    ],
  },
]);

/** Look one up. Unknown is `null` — never a nearest match, because binding a
 *  role to something the operator did not name is the whole failure this
 *  registry exists to prevent. */
export function findOccupant(role: RoleSlot, occupantId: string): RoleOccupant | null {
  return ROLE_OCCUPANTS.find((o) => o.role === role && o.occupantId === occupantId) ?? null;
}

/** Every occupant registered for a role, in registration order. */
export function occupantsForRole(role: RoleSlot): readonly RoleOccupant[] {
  return ROLE_OCCUPANTS.filter((o) => o.role === role);
}

/**
 * The occupant each role falls back to when a deployment names none.
 *
 * These reproduce Relay's behaviour before role slots existed, so an
 * unconfigured development machine is unchanged. A HOSTED deployment gets no
 * default at all — see `bindRoleSlots`, which treats an unnamed slot in
 * production as a configuration error rather than guessing. That asymmetry is
 * deliberate and copied from `selectHermesMode`, where guessing in production
 * was the original bug.
 */
export const DEVELOPMENT_DEFAULT_OCCUPANTS: Readonly<Record<RoleSlot, string>> = Object.freeze({
  // THE UNMETERED ONE. Before role slots existed, an unconfigured machine had
  // no architect at all (`selectArchitectPath` answered `blocked`), so there is
  // no prior behaviour to reproduce here — and a default that names the
  // API-billed provider is the kind of default that becomes load-bearing later.
  // In practice the architect is selected by its own mode and never falls back
  // to this; when it does, it falls back to the path that spends nothing.
  prompt_architect: 'fusion_architect',
  coding_agent: 'claude_code_local',
  reviewer: 'hermes_local',
});

/** Sanity: every role has at least one registered occupant and one default. */
export function registryIsComplete(): boolean {
  return ROLE_SLOTS.every((role) =>
    occupantsForRole(role).length > 0
    && findOccupant(role, DEVELOPMENT_DEFAULT_OCCUPANTS[role]) !== null);
}
