import type { RelayBackdropId } from '../../shared/relay-stage-backdrop';
import type { ProjectBriefDraft } from '../entry-home/contracts';
import type { ProjectSettingsDraft } from '../project-settings/contracts';
import type {
  CodingTerminalState,
  LiveMissionUpdate,
  MissionArchitectReceipt,
  MissionAttestationSummary,
  MissionClaim,
  MissionError,
  MissionHandoff,
  MissionPhase,
  MissionReview,
  MissionRole,
  RelayEvent,
  RelayMissionState,
} from '../../mission/wire-contracts';

/**
 * RELAY BROWSER APPLICATION — browser store records.
 *
 * These are the persisted records behind the product flow:
 *   Entry Home → Ask Relay → Project Brief → Project Settings →
 *   Active Workspace → Relay Console → Mission progression.
 *
 * Layering: contracts (here) → application services/store → persistence
 * adapter → view components. The UI reuses the existing screen contracts
 * (ProjectBriefDraft, ProjectSettingsDraft) rather than duplicating their
 * schemas; this module adds identity, lifecycle, and the browser's own
 * storage shape.
 *
 * The MISSION WIRE CONTRACTS — mission state and phase, the handoff, the
 * claim, the review, the attestations, the coding terminal and the persisted
 * event — are NOT declared here. They are domain records shared with the Relay
 * bridge and the mission layer, so they live in
 * `src/relay/mission/wire-contracts.ts`; a module must never have to import
 * the website tree in order to describe a mission. They are re-exported below
 * so this barrel stays the single import site for the browser application.
 *
 * The browser is never the policy authority: mission state only moves
 * through the mission machine, and VERIFIED COMPLETE derives from the
 * machine + completion policy — never from a component.
 */

export type {
  CodingTerminalAttestation,
  CodingTerminalLine,
  CodingTerminalLineKind,
  CodingTerminalPermissions,
  CodingTerminalState,
  CodingTerminalStatus,
  CodingTerminalTest,
  LiveMissionUpdate,
  MissionArchitectReceipt,
  MissionAttestationSummary,
  MissionClaim,
  MissionError,
  MissionHandoff,
  MissionPhase,
  MissionReview,
  MissionReviewFinding,
  MissionRole,
  RelayEvent,
  RelayMissionState,
} from '../../mission/wire-contracts';

/* ------------------------------------------------------------- project */

export type RelayProjectStatus =
  | 'draft' // brief exists, settings not confirmed
  | 'configured' // settings confirmed, mission not started
  | 'active' // mission in progress
  | 'complete'; // mission verified complete

export interface RelayProject {
  id: string;
  /** Route reference, e.g. "RLY / 002". */
  reference: string;
  name: string;
  summary: string;
  /** The founder's exact Ask Relay wording — always preserved verbatim. */
  originalRequest: string;
  status: RelayProjectStatus;
  /** True for the deterministic demo path — demo events can never enter a
      non-demo project (machine-enforced). */
  demo: boolean;
  createdAt: string;
  updatedAt: string;
  activeMissionId: string | null;
}

/* ------------------------------------------------- brief + settings */

export interface StoredProjectBrief {
  projectId: string;
  /** The structured draft the screens already render. */
  draft: ProjectBriefDraft;
  approved: boolean;
  generatedAt: string;
  updatedAt: string;
}

export interface StoredProjectSettings {
  projectId: string;
  draft: ProjectSettingsDraft;
  confirmed: boolean;
  updatedAt: string;
}

/* -------------------------------------------------------- project brain */

export interface ProjectBrain {
  projectId: string;
  projectSummary: string;
  knownTechnologies: string[];
  architectureNotes: string[];
  decisions: string[];
  constraints: string[];
  assumptions: string[];
  researchNotes: string[];
  recentHandoffs: string[];
  lastUpdatedAt: string;
}

/* ------------------------------------------------------------- mission */

/** The browser's own mission STORE RECORD. The mission vocabulary it is built
    from (state, phase, role, handoff, claim, terminal, review, attestations)
    is domain, not UI, and is imported from `mission/wire-contracts`. */
export interface RelayMission {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  state: RelayMissionState;
  currentRole: MissionRole;
  /** Index into the deterministic demo script; -1 for non-demo missions. */
  currentStep: number;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Live missions only — the structured architect handoff, the coding-agent
      claim, and the last safe error, mirrored from the backend authority.
      Absent for demo missions (which derive everything from the script). */
  handoff?: MissionHandoff;
  claim?: MissionClaim;
  error?: MissionError;
  /** Persisted Coding Agent terminal state, so a refresh restores the exact
      terminal (ordered lines, diff, test result) without redispatching. */
  terminal?: CodingTerminalState;
  /** Live three-role missions — mirrored from the backend authority so a
      refresh restores the whole role record without redispatching anything. */
  phase?: MissionPhase;
  missionRevision?: string;
  handoffDigest?: string;
  artifactDigest?: string;
  architectReceipt?: MissionArchitectReceipt;
  review?: MissionReview;
  attestations?: MissionAttestationSummary[];
}

/* -------------------------------------------------------- persistence */

export const RELAY_APP_SCHEMA_VERSION = 1;

export interface RelayAppData {
  schemaVersion: typeof RELAY_APP_SCHEMA_VERSION;
  projects: RelayProject[];
  briefs: Record<string, StoredProjectBrief>;
  settings: Record<string, StoredProjectSettings>;
  brains: Record<string, ProjectBrain>;
  missions: Record<string, RelayMission>;
  /** Events per mission id, ordered by sequence. */
  events: Record<string, RelayEvent[]>;
  activeProjectId: string | null;
  colorway: 'obsidian' | 'midnight' | 'manual';
  /**
   * The chosen stage scenery, or `null` for no scene.
   *
   * SCENERY ONLY. It gates nothing, is never part of a mission record, and
   * cannot change what any surface reports — it is stored beside the colorway
   * because it is the same kind of thing: how this browser looks, to this user.
   *
   * `null` MEANS NO CHOICE HAS BEEN RECORDED — either this browser has never
   * picked one, or what it stored is not a backdrop this build has. Choosing
   * "None" in the picker stores the string `'none'`, because `'none'` is a real
   * member of the catalog. The two draw the same thing and are not the same
   * fact, and an earlier version of this comment claimed `null` was the chosen
   * one, which the picker's own radio value contradicts.
   *
   * Neither is rendered as Unknown on the website: a radio group has to show
   * something selected, and None is the honest default to show when nothing has
   * been chosen. The CLI, which cannot read this store at all, says Unknown —
   * that is a different question with a different answer.
   */
  stageBackdrop: RelayBackdropId | null;
  updatedAt: string;
}

export function emptyRelayAppData(): RelayAppData {
  return {
    schemaVersion: RELAY_APP_SCHEMA_VERSION,
    projects: [],
    briefs: {},
    settings: {},
    brains: {},
    missions: {},
    events: {},
    activeProjectId: null,
    colorway: 'obsidian',
    stageBackdrop: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/* --------------------------------------------------- adapter boundary */

/** The replaceable application boundary. The demo adapter is deterministic
    and offline; the live adapter (`kind: 'live'`) implements the same
    interface against the real Relay bridge (a server that runs the real
    Sunday Alcatraz architect and Claude Code coding agent) without rewriting
    the UI. Provider credentials NEVER live in an adapter — the live adapter
    knows only a non-secret bridge URL. */
export interface RelayApplicationAdapter {
  /** Honest origin label: 'demo' = deterministic offline script; 'live' =
      real backend-driven mission. Surfaced wherever origin matters. */
  readonly kind: 'demo' | 'live';
  createProjectBrief(request: string): ProjectBriefDraft;
  prepareProjectBrain(input: {
    projectId: string;
    brief: ProjectBriefDraft;
    settings: ProjectSettingsDraft | null;
  }): ProjectBrain;
  /** Deterministic next step for a demo mission. Returns the events to
      append and the next state; null when the mission cannot advance (always
      null for a live mission — live progression comes from polling). */
  advanceMission(input: {
    mission: RelayMission;
    existingEvents: RelayEvent[];
  }): { nextState: RelayMissionState; role: MissionRole; events: Omit<RelayEvent, 'id' | 'missionId' | 'sequence' | 'demo'>[] } | null;

  /* -------- live adapters only (absent on the demo adapter) -------- */

  /** Begin a real mission on the backend and return the initial authoritative
      update. Idempotent by the mission id — a repeat call never dispatches a
      second provider run. */
  startMission?(input: {
    mission: RelayMission;
    project: RelayProject;
    settings: StoredProjectSettings;
  }): Promise<LiveMissionUpdate>;
  /** Fetch the current authoritative mission state + full event list. */
  pollMission?(input: { mission: RelayMission }): Promise<LiveMissionUpdate>;
  /** Request safe cancellation of an in-flight mission. */
  cancelMission?(input: { mission: RelayMission }): Promise<LiveMissionUpdate>;
  /** Retry a failed mission (bounded server-side). */
  retryMission?(input: { mission: RelayMission }): Promise<LiveMissionUpdate>;
}
