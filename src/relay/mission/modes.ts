import { fail, ok, relayError, type RelayResult } from '../protocol/errors';

/**
 * Operational modes (Prompt 8.2) — PURE, browser-safe. Guided / Semi /
 * Autonomous are canonical Relay policies that set the concrete limits and
 * stop-conditions Relay Core already enforces (loop/budget/checkpoint). The
 * UI submits a mode command and displays policy; it never decides
 * permissions. Escalation to Autonomous requires an explicit, specific,
 * immutable consent event; a reduction takes effect immediately. Autonomous
 * is bounded execution inside an approved boundary — never unrestricted.
 */

export const RELAY_MODES = ['guided', 'semi', 'autonomous'] as const;
export type RelayMode = (typeof RELAY_MODES)[number];

export type CheckpointStrictness = 'ask_often' | 'ask_high_impact' | 'ask_boundary_only';
export type ServicePolicy = 'approved_only_with_consent' | 'approved_only' | 'approved_scoped';
export type CredentialHandlePolicy = 'disabled' | 'approved_scoped';
export type DestructivePolicy = 'always_ask' | 'always_stop';
export type DeploymentPolicy = 'always_ask' | 'preauthorized_only' | 'prohibited';
export type PermissionExpansionPolicy = 'always_ask' | 'always_stop';
export type ReviewerPolicy = 'entitlement_default' | 'required_when_entitled';
export type DisagreementPolicy = 'stop_on_high_risk';

export interface RelayModePolicy {
  mode: RelayMode;
  version: number;
  automaticStepLimit: number;
  automaticRepairLimit: 0 | 1;
  maximumRuntimeMinutes: number;
  maximumSpendUsd: number;
  checkpointPolicy: CheckpointStrictness;
  externalServicePolicy: ServicePolicy;
  credentialHandlePolicy: CredentialHandlePolicy;
  destructiveActionPolicy: DestructivePolicy;
  deploymentPolicy: DeploymentPolicy;
  permissionExpansionPolicy: PermissionExpansionPolicy;
  reviewerPolicy: ReviewerPolicy;
  disagreementPolicy: DisagreementPolicy;
  approvedTools: string[];
  prohibitedTools: string[];
  consentRequired: boolean;
  consentExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const BASE_PROHIBITED = ['Bash(rm *)', 'git push', 'git reset --hard', 'deploy', 'db:drop'];

export function defaultModePolicy(mode: RelayMode, now: string): RelayModePolicy {
  const common = {
    mode, version: 1, createdAt: now, updatedAt: now,
    disagreementPolicy: 'stop_on_high_risk' as const,
    prohibitedTools: [...BASE_PROHIBITED],
    consentExpiresAt: null as string | null,
  };
  switch (mode) {
    case 'guided':
      return {
        ...common, automaticStepLimit: 6, automaticRepairLimit: 1, maximumRuntimeMinutes: 10, maximumSpendUsd: 1,
        checkpointPolicy: 'ask_often', externalServicePolicy: 'approved_only_with_consent',
        credentialHandlePolicy: 'disabled', destructiveActionPolicy: 'always_ask', deploymentPolicy: 'always_ask',
        permissionExpansionPolicy: 'always_ask', reviewerPolicy: 'entitlement_default',
        approvedTools: ['Read', 'Glob', 'Grep', 'Edit'], consentRequired: false,
      };
    case 'semi':
      return {
        ...common, automaticStepLimit: 20, automaticRepairLimit: 1, maximumRuntimeMinutes: 20, maximumSpendUsd: 2,
        checkpointPolicy: 'ask_high_impact', externalServicePolicy: 'approved_only',
        credentialHandlePolicy: 'approved_scoped', destructiveActionPolicy: 'always_stop', deploymentPolicy: 'always_ask',
        permissionExpansionPolicy: 'always_stop', reviewerPolicy: 'required_when_entitled',
        approvedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'], consentRequired: false,
      };
    case 'autonomous':
      return {
        ...common, automaticStepLimit: 60, automaticRepairLimit: 1, maximumRuntimeMinutes: 30, maximumSpendUsd: 5,
        checkpointPolicy: 'ask_boundary_only', externalServicePolicy: 'approved_scoped',
        credentialHandlePolicy: 'approved_scoped', destructiveActionPolicy: 'always_stop',
        deploymentPolicy: 'preauthorized_only', permissionExpansionPolicy: 'always_stop',
        reviewerPolicy: 'required_when_entitled',
        approvedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'], consentRequired: true,
      };
  }
}

/* --------------------------- autonomous consent --------------------- */

export interface AutonomousAccessGrant {
  services: string[];
  projects: string[];
  tools: string[];
  credentialHandleIds: string[];
  maximumSpendUsd: number;
  maximumRuntimeMinutes: number;
  deploymentPermitted: boolean;
  destructiveActionPermitted: boolean;
  reviewerPolicy: ReviewerPolicy;
  expiresAt: string;
}

export interface AutonomousConsent {
  consentId: string;
  grantedBy: string;
  grantedAt: string;
  access: AutonomousAccessGrant;
  immutable: true;
}

/** Consent must be SPECIFIC — there is no "access everything" grant. */
export function validateAutonomousAccess(access: AutonomousAccessGrant): string[] {
  const errors: string[] = [];
  if (access.services.some((s) => s === '*' || s.toLowerCase() === 'all')) errors.push('an "all services" grant is not allowed — consent must be specific.');
  if (access.tools.some((t) => t === '*' || t.toLowerCase() === 'all')) errors.push('an "all tools" grant is not allowed — consent must be specific.');
  if (access.maximumSpendUsd < 0) errors.push('maximum spend must be non-negative.');
  if (access.maximumRuntimeMinutes <= 0) errors.push('maximum runtime must be positive.');
  if (!access.expiresAt) errors.push('an expiration is required for autonomous access.');
  return errors;
}

export function buildAutonomousConsent(input: { consentId: string; grantedBy: string; grantedAt: string; access: AutonomousAccessGrant }): RelayResult<AutonomousConsent> {
  const errors = validateAutonomousAccess(input.access);
  if (errors.length > 0) return fail(relayError('validation-failed', 'Autonomous consent is invalid.', { details: errors }));
  return ok(Object.freeze({ ...input, immutable: true as const }));
}

/* --------------------------- mode transitions ----------------------- */

const RANK: Record<RelayMode, number> = { guided: 0, semi: 1, autonomous: 2 };

export interface ModeTransition {
  policy: RelayModePolicy;
  event: { kind: 'mode.selected'; from: RelayMode; to: RelayMode; immutable: boolean; at: string; consentId?: string };
}

/**
 * Select a mode. Escalating INTO autonomous requires a valid consent
 * (immutable event). Any reduction (or lateral to a lower rank) applies
 * immediately with no consent. Escalation to semi from guided needs no
 * consent (only autonomous is consent-gated).
 */
export function selectMode(
  current: RelayMode, target: RelayMode, now: string, consent?: AutonomousConsent,
): RelayResult<ModeTransition> {
  if (target === 'autonomous' && RANK[current] < RANK.autonomous) {
    if (!consent) return fail(relayError('permission-denied', 'Autonomous mode requires explicit consent.'));
    return ok({
      policy: { ...defaultModePolicy('autonomous', now), consentExpiresAt: consent.access.expiresAt },
      event: { kind: 'mode.selected', from: current, to: 'autonomous', immutable: true, at: now, consentId: consent.consentId },
    });
  }
  // Reduction or non-autonomous escalation: immediate, no consent event.
  return ok({
    policy: defaultModePolicy(target, now),
    event: { kind: 'mode.selected', from: current, to: target, immutable: RANK[target] > RANK[current], at: now },
  });
}

/* ------------------------- boundary stop list ----------------------- */

/** Actions that stop even Autonomous — bounded execution, never unrestricted. */
export const AUTONOMOUS_STOP_ACTIONS = [
  'missing_authentication', 'multi_factor', 'captcha', 'identity_verification',
  'new_credential_creation', 'new_financial_commitment', 'irreversible_deletion',
  'legal_acceptance', 'terms_acceptance', 'security_control_removal',
  'access_control_weakening', 'secret_export', 'unsupported_enforcement',
  'unresolved_high_risk_disagreement', 'beyond_mission_scope', 'beyond_approved_access',
  'production_deployment_unless_preauthorized',
] as const;
export type BoundaryAction = (typeof AUTONOMOUS_STOP_ACTIONS)[number];

/** Semi additionally stops for high-impact actions Autonomous may bound. */
export const SEMI_STOP_ACTIONS = [
  'destructive_action', 'deployment', 'new_spending', 'new_services',
  'irreversible_migration', 'access_expansion', 'protected_resource_access',
  'ambiguous_product_decision',
] as const;

/** Does `action` force a stop under `mode`? Deterministic policy — the mode
 * never lets an adapter increase autonomy. */
export function actionRequiresStop(mode: RelayMode, action: BoundaryAction | (typeof SEMI_STOP_ACTIONS)[number], preauthorizedDeployment = false): boolean {
  if ((AUTONOMOUS_STOP_ACTIONS as readonly string[]).includes(action)) {
    if (action === 'production_deployment_unless_preauthorized') return !preauthorizedDeployment;
    return true; // stops in every mode
  }
  // Semi/guided stop-list high-impact actions; autonomous MAY bound some but
  // still stops for the boundary list above.
  if (mode === 'autonomous') {
    // Autonomous bounds routine high-impact work but still stops for
    // deployment (unless preauthorized) and destructive actions.
    if (action === 'deployment') return !preauthorizedDeployment;
    if (action === 'destructive_action') return true;
    return false;
  }
  return true; // guided + semi stop for the high-impact list
}
