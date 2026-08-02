/**
 * SUNDAY RELAY — LOOP FEATURE GATES AND THE UNCHAIN GATE.
 *
 * TWO JOBS, both fail-closed.
 *
 * 1. FEATURE FLAGS. The Loop Engine ships dark. Every flag defaults to OFF,
 *    an unparseable value is OFF, and an ABSENT flag record is OFF. There is
 *    no combination of missing configuration that turns something on.
 *
 * 2. THE UNCHAIN GATE. S-Loops require a valid, server-authoritative Unchain
 *    session. Unchain DOES NOT EXIST in this repository yet, and this module
 *    says so truthfully rather than pretending: with no session record, the
 *    answer is `unavailable` with a reason, never a fabricated session.
 *
 * WHAT UNCHAIN IS, AS RESOLVED BY THE FOUNDER (see docs/relay/UNCHAIN.md).
 * Unchain expands CAPACITY, never AUTHORITY. It grants exactly two temporary
 * agent slots, a configurable temporary plugin capacity, S-Loop eligibility,
 * and the Unchained Form and Meter. It grants no permission, expands no
 * workspace access, and bypasses no approval, budget, policy, MCP or plugin
 * permission, provider restriction or verification requirement.
 *
 * THE ANTI-FORGERY RULE, and why this file is shaped the way it is. Everything
 * here is a PURE function of a record the SERVER supplies. There is no
 * constructor for an `UnchainSessionRecord` in the domain, no default that
 * grants capacity, and no field a client could set to become eligible. A
 * browser can pass whatever it likes; the worst it achieves is being told no.
 */

import type { RelayAgentRole } from '../agent-operating';
import type { RelaySlashCommand } from './loop-command-types';
import { runtimeBlocker, type RelayLoopBlocker } from './loop-blockers';

/* -------------------------------------------------------------- features */

/**
 * The Loop Engine's feature surface. Named here so a preview can state which
 * flags were in force when it was compiled, and so a disabled feature produces
 * a blocker naming the flag rather than a shrug.
 */
export const RELAY_LOOP_FEATURES = [
  'loop_engine',
  'loop_scheduler',
  'loop_cron',
  'unchain',
  'sloop',
  'cron_sloop',
] as const;
export type RelayLoopFeature = (typeof RELAY_LOOP_FEATURES)[number];

export type RelayLoopFeatureFlags = Readonly<Partial<Record<RelayLoopFeature, boolean>>>;

/** Every feature off. The value used whenever configuration is absent. */
export const ALL_LOOP_FEATURES_DISABLED: RelayLoopFeatureFlags = Object.freeze({});

/**
 * Is a feature on?
 *
 * Fail-closed by construction: only the literal boolean `true` enables. An
 * absent record, an absent key, `undefined`, `null`, `'true'` as a string —
 * all off. A feature that can be enabled by accident is not a gate.
 */
export function featureEnabled(
  flags: RelayLoopFeatureFlags | null | undefined,
  feature: RelayLoopFeature,
): boolean {
  return flags?.[feature] === true;
}

/**
 * Features that require another feature first. Enabling a dependent flag alone
 * does nothing — a swarm with no Unchain is not a swarm, and a scheduler with
 * no engine is a timer with no supervision.
 */
export const RELAY_LOOP_FEATURE_DEPENDENCIES: Readonly<Partial<Record<RelayLoopFeature, RelayLoopFeature>>> =
  Object.freeze({
    loop_scheduler: 'loop_engine',
    loop_cron: 'loop_scheduler',
    sloop: 'unchain',
    cron_sloop: 'sloop',
  });

/** Is a feature on AND is everything it depends on also on? */
export function featureEffectivelyEnabled(
  flags: RelayLoopFeatureFlags | null | undefined,
  feature: RelayLoopFeature,
): boolean {
  let current: RelayLoopFeature | undefined = feature;
  const seen = new Set<RelayLoopFeature>();
  while (current !== undefined) {
    if (seen.has(current)) return false; // a cycle is a misconfiguration; fail closed
    seen.add(current);
    if (!featureEnabled(flags, current)) return false;
    current = RELAY_LOOP_FEATURE_DEPENDENCIES[current];
  }
  return true;
}

/* --------------------------------------------------------------- unchain */

/** How much life the Unchain Meter reports. Server-authoritative. */
export const UNCHAIN_METER_STATES = ['active', 'low', 'critical', 'expired'] as const;
export type UnchainMeterState = (typeof UNCHAIN_METER_STATES)[number];

/** Meter states in which capacity is still granted. `critical` still grants —
 *  Rechaining is a controlled collapse, not an instant cut. */
export const UNCHAIN_GRANTING_STATES: readonly UnchainMeterState[] = ['active', 'low', 'critical'];

/**
 * EXACTLY TWO. Written as a literal typed `2` rather than a configurable
 * number, so changing it is a visible type change in review rather than a
 * config drift nobody notices.
 */
export const UNCHAIN_TEMPORARY_SLOTS = 2 as const;

/**
 * What the SERVER observed about an Unchain session. There is deliberately no
 * builder for this in the domain: it is evidence, and evidence is produced by
 * whatever actually saw it.
 */
export interface UnchainSessionRecord {
  readonly sessionId: string;
  readonly meterState: UnchainMeterState;
  readonly expiresAt: string;
  /** Temporary slots this session grants. Always `UNCHAIN_TEMPORARY_SLOTS`. */
  readonly temporarySlots: typeof UNCHAIN_TEMPORARY_SLOTS;
  readonly temporaryPluginCapacity: number;
  /** When the server last re-verified the session. `null` is Unknown, and
   *  Unknown never grants. */
  readonly lastAttestedAt: string | null;
  /** True only when the grant arrived over an operator credential. A browser
   *  session is read-only by construction and can never set this. */
  readonly grantedToOperator: boolean;
}

/* ------------------------------------------------------------ the gates */

export const RELAY_LOOP_AVAILABILITY_STATES = ['available', 'unavailable'] as const;
export type RelayLoopAvailabilityState = (typeof RELAY_LOOP_AVAILABILITY_STATES)[number];

export interface RelayLoopAvailability {
  readonly state: RelayLoopAvailabilityState;
  /** Every reason it is unavailable, as real blockers. Empty when available. */
  readonly blockers: readonly RelayLoopBlocker[];
  /** Temporary slots this evaluation grants. `0` unless a valid Unchain
   *  session is present — never a hopeful default. */
  readonly grantedTemporarySlots: number;
  /** Roles a temporary slot may take. Unchain expands capacity, not
   *  authority, so this is the ORDINARY role set and nothing more. */
  readonly temporarySlotRoles: readonly RelayAgentRole[];
}

export interface RelayLoopAvailabilityInput {
  readonly command: RelaySlashCommand;
  readonly flags: RelayLoopFeatureFlags | null | undefined;
  /** `null` means no session — which is the truthful state today, because
   *  Unchain is specified but not implemented. */
  readonly unchain: UnchainSessionRecord | null;
  /** Roles Relay actually has, for temporary-slot eligibility. */
  readonly assignableRoles: readonly RelayAgentRole[];
  readonly observedAt: string;
}

function commandNeedsUnchain(command: RelaySlashCommand): boolean {
  return (
    command.kind === 'sloop_composer' ||
    command.kind === 'sloop_create' ||
    command.kind === 'sloop_action'
  );
}

function commandNeedsCron(command: RelaySlashCommand): boolean {
  return (
    command.kind === 'loop_schedule_composer' ||
    command.kind === 'loop_schedule_create' ||
    command.kind === 'loop_cron_create' ||
    command.kind === 'loop_schedule_list'
  );
}

/**
 * Evaluate whether a parsed command may proceed.
 *
 * Collects EVERY reason rather than short-circuiting, so a user is told the
 * whole truth in one answer: "the Loop Engine is off AND you have no Unchain
 * session" beats discovering those one at a time.
 */
export function evaluateLoopAvailability(
  input: RelayLoopAvailabilityInput,
): RelayLoopAvailability {
  const context = { observedAt: input.observedAt };
  const blockers: RelayLoopBlocker[] = [];

  if (!featureEffectivelyEnabled(input.flags, 'loop_engine')) {
    blockers.push(
      runtimeBlocker(
        {
          kind: 'feature_disabled',
          feature: 'the Loop Engine',
          detail: 'The Loop Engine is not enabled in this environment.',
        },
        context,
      ),
    );
  }

  if (commandNeedsCron(input.command) && !featureEffectivelyEnabled(input.flags, 'loop_cron')) {
    blockers.push(
      runtimeBlocker(
        {
          kind: 'feature_disabled',
          feature: 'Cron Loops',
          detail: 'Cron Loops are not enabled in this environment. The grammar is understood; the runtime is not active.',
        },
        context,
      ),
    );
  }

  let grantedTemporarySlots = 0;

  if (commandNeedsUnchain(input.command)) {
    if (!featureEffectivelyEnabled(input.flags, 'sloop')) {
      blockers.push(
        runtimeBlocker(
          {
            kind: 'feature_disabled',
            feature: 'S-Loops',
            detail: 'S-Loops are not enabled in this environment.',
          },
          context,
        ),
      );
    }
    const unchainProblem = unchainSessionProblem(input.unchain);
    if (unchainProblem !== null) {
      blockers.push(
        runtimeBlocker(
          { kind: 'feature_disabled', feature: 'Unchain', detail: unchainProblem },
          context,
        ),
      );
    } else if (input.unchain !== null) {
      grantedTemporarySlots = input.unchain.temporarySlots;
    }
  }

  return {
    state: blockers.length === 0 ? 'available' : 'unavailable',
    blockers,
    // Slots are granted only when nothing blocks. A partially-blocked S-Loop
    // does not get "most" of its capacity.
    grantedTemporarySlots: blockers.length === 0 ? grantedTemporarySlots : 0,
    // Capacity, never authority: a temporary slot may take exactly the roles
    // an ordinary slot may take.
    temporarySlotRoles: blockers.length === 0 && grantedTemporarySlots > 0 ? [...input.assignableRoles] : [],
  };
}

/**
 * Why this Unchain session cannot grant capacity, or `null` when it can.
 *
 * Every branch fails closed. `null` session, expired meter, unknown
 * attestation, a grant that did not arrive over an operator credential — each
 * is a refusal with a reason, and none of them is recoverable by anything a
 * client sends.
 */
export function unchainSessionProblem(session: UnchainSessionRecord | null): string | null {
  if (session === null) {
    return 'No server-authoritative Unchain session is active. Unchain is specified but not yet implemented in this build, so no session can exist.';
  }
  if (!session.grantedToOperator) {
    return 'This Unchain session was not granted over an operator credential and cannot expand capacity.';
  }
  if (session.lastAttestedAt === null) {
    return 'This Unchain session has never been re-verified by the server; an unattested session never grants capacity.';
  }
  if (!UNCHAIN_GRANTING_STATES.includes(session.meterState)) {
    return `The Unchain Meter reads "${session.meterState}", which grants no capacity.`;
  }
  if (session.temporarySlots !== UNCHAIN_TEMPORARY_SLOTS) {
    return `An Unchain session grants exactly ${UNCHAIN_TEMPORARY_SLOTS} temporary slots; this one reports ${session.temporarySlots}.`;
  }
  return null;
}
