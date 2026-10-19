/**
 * THE WONDERLAND PROJECT — the user's durable workspace.
 *
 * A Mission Contract is one task. A PROJECT is sustained work: file-heavy,
 * multi-task, and something the user comes back to on Tuesday having closed
 * Wonderland on Monday. This module is the durable half of that promise.
 *
 * THREE THINGS THAT SHARE A WORD, kept apart deliberately:
 *
 *   RelayProject          Relay's internal run-scoping record (`protocol/
 *                         contracts.ts`). It scopes a MISSION EXECUTION. It is
 *                         not the user's workspace and is not named here.
 *   Project Brain         Julius's durable intelligence, memory and state.
 *                         Owned by another lane. A project REFERENCES it and
 *                         never contains it.
 *   WonderlandProject     THIS. The user's files, assets, creations, mission
 *                         references and Project Avatar.
 *
 * Collapsing any two of them is how a user's work would come to be deleted when
 * a run is cleaned up, so the separation is structural: nothing in this file
 * imports a run, and the Brain appears only as an opaque reference string.
 *
 * PURE. No Node, no clock, no storage. Times arrive as injected ISO strings.
 */

/* ------------------------------------------------------------- versioning */

export const WONDERLAND_PROJECT_SCHEMA_V1 = 'relay-wonderland-project.v1' as const;
export const WONDERLAND_PROJECT_SCHEMA_VERSION = WONDERLAND_PROJECT_SCHEMA_V1;
export const SUPPORTED_WONDERLAND_PROJECT_SCHEMA_VERSIONS = [
  WONDERLAND_PROJECT_SCHEMA_V1,
] as const;
export type WonderlandProjectSchemaVersion =
  (typeof SUPPORTED_WONDERLAND_PROJECT_SCHEMA_VERSIONS)[number];

/* ------------------------------------------------------------ vocabularies */

/**
 * `ACTIVE` and `ARCHIVED` are the whole vocabulary, and there is no `DELETED`.
 *
 * Archiving is reversible and deletion is not, so the beta offers only the
 * reversible one. A user who archives a project can reopen it; a user who
 * deleted one would have no recourse, and nothing in this system is valuable
 * enough to justify that before there is a restore path.
 */
export const WONDERLAND_PROJECT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type WonderlandProjectStatus = (typeof WONDERLAND_PROJECT_STATUSES)[number];

/**
 * THE FIVE HUMAN ROLES, from the founder's multiplayer definition.
 *
 * `reviewer` here is a PERSON WITH PERMISSIONS. It is not, and must never
 * become, Relay's independent Harnessing Reviewer — the automated gate a
 * mission must pass. They share a word and nothing else. Letting a human
 * `reviewer` satisfy the automated gate would turn a verification gate into a
 * social one, which the definition names as the single most damaging thing
 * multiplayer could do to this product. `project-workspace.test.ts` asserts that
 * no function here grants verification authority.
 */
export const WONDERLAND_PROJECT_ROLES = [
  'project_leader',
  'editor',
  'developer',
  'reviewer',
  'viewer',
] as const;
export type WonderlandProjectRole = (typeof WONDERLAND_PROJECT_ROLES)[number];

/** Wave 0 ceiling, stated once. Five HUMAN collaborators per project. */
export const WONDERLAND_PROJECT_MAX_COLLABORATORS = 5;

/**
 * What a member may do. Derived from the role, never stored per-member, so a
 * role change cannot leave a stale capability behind on someone's record.
 */
export const WONDERLAND_PROJECT_CAPABILITIES = [
  'view_project',
  'edit_files',
  'create_mission',
  'start_mission',
  'approve_action',
  'change_configuration',
  'manage_collaborators',
  'archive_project',
] as const;
export type WonderlandProjectCapability = (typeof WONDERLAND_PROJECT_CAPABILITIES)[number];

/**
 * ROLE -> CAPABILITIES. Total over the role vocabulary, so a new role cannot be
 * added without deciding what it may do.
 *
 * Note what `reviewer` does NOT have: `start_mission` and `change_configuration`.
 * A human reviewer reviews; they do not spend the budget or move the gate.
 */
export const WONDERLAND_ROLE_CAPABILITIES: Readonly<
  Record<WonderlandProjectRole, readonly WonderlandProjectCapability[]>
> = Object.freeze({
  project_leader: [
    'view_project', 'edit_files', 'create_mission', 'start_mission',
    'approve_action', 'change_configuration', 'manage_collaborators', 'archive_project',
  ],
  editor: ['view_project', 'edit_files', 'create_mission'],
  developer: ['view_project', 'edit_files', 'create_mission', 'start_mission'],
  reviewer: ['view_project', 'approve_action'],
  viewer: ['view_project'],
});

/* ------------------------------------------------------------- membership */

export interface WonderlandProjectMember {
  /** The persistent Wonderland account. Never a display name, never a session. */
  readonly userId: string;
  readonly role: WonderlandProjectRole;
  readonly addedAtIso: string;
  /** Who added them. Actor attribution is part of the record, always. */
  readonly addedByUserId: string;
}

/* ------------------------------------------------------------------ files */

/**
 * One file in the workspace.
 *
 * `path` carries the folder structure — a separate folder record would be a
 * second source of truth about the same tree. Folders therefore exist exactly
 * when a file names them, which also means an empty folder does not survive a
 * reload, and that is a limitation worth stating rather than hiding.
 */
export interface WonderlandProjectFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string | null;
  readonly mediaType: string | null;
  readonly updatedAtIso: string;
  /** Increments on each save of this path. The user-visible version. */
  readonly revision: number;
  /** Where it came from. A generated file is not a hand-authored one. */
  readonly origin: 'authored' | 'generated' | 'imported' | 'creation_output';
}

/** An asset is a file the user did not write. Same shape, separate list. */
export type WonderlandProjectAsset = WonderlandProjectFile;

/* ----------------------------------------------------------- the avatar */

/**
 * PROJECT AVATAR V1 — enough identity to represent the project in the world.
 *
 * DELIBERATELY SMALL. The ultimate Project Avatar is not attempted here. What
 * matters for the beta is that the avatar is a SEPARATE record referenced by the
 * project, carrying only identity and a placeholder manifestation — so a richer
 * embodiment later replaces `manifestation` and `formHint` and rewrites NOTHING
 * about project storage. A test asserts the avatar holds no file, no creation
 * and no mission, which is what keeps that true.
 */
export const WONDERLAND_AVATAR_MANIFESTATIONS = [
  /** The beta's stand-in. Named `placeholder` so it cannot read as finished. */
  'placeholder_sigil',
] as const;
export type WonderlandAvatarManifestation =
  (typeof WONDERLAND_AVATAR_MANIFESTATIONS)[number];

export interface WonderlandProjectAvatar {
  readonly avatarId: string;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly displayName: string;
  readonly manifestation: WonderlandAvatarManifestation;
  /**
   * A stable hint a renderer may use to vary the placeholder per project. Derived
   * from the project id, so the same project always looks like itself.
   */
  readonly formHint: string;
  /** Mirrors the project. A renderer shows an archived project as dormant. */
  readonly status: WonderlandProjectStatus;
  readonly updatedAtIso: string;
}

/* ----------------------------------------------------------- the project */

/**
 * THE PROJECT RECORD.
 *
 * `creationIds` and `missionIds` are REFERENCES. The creation lives in the
 * Wonder Web store and the mission lives in Julius's runtime; copying either one
 * here would create a second copy that drifts. `brainRef` is likewise opaque —
 * this module never reads it and never writes it.
 */
export interface WonderlandProject {
  readonly schemaVersion: WonderlandProjectSchemaVersion;
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly description: string;
  readonly status: WonderlandProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly members: readonly WonderlandProjectMember[];
  readonly files: readonly WonderlandProjectFile[];
  readonly assets: readonly WonderlandProjectAsset[];
  /** Creations saved into this project. Ids only. */
  readonly creationIds: readonly string[];
  /** Missions associated with this project. Ids only. */
  readonly missionIds: readonly string[];
  readonly avatar: WonderlandProjectAvatar;
  /** Opaque pointer to the Project Brain, which another lane owns. */
  readonly brainRef: string | null;
  /** Increments on every accepted mutation. */
  readonly version: number;
  readonly checksum: string;
}

export type WonderlandProjectDraft = Omit<WonderlandProject, 'checksum'>;

/* ------------------------------------------------------------- derivations */

/** Every capability a user holds on a project. Empty for a non-member. */
export function capabilitiesFor(
  project: WonderlandProjectDraft,
  userId: string,
): readonly WonderlandProjectCapability[] {
  const member = project.members.find((candidate) => candidate.userId === userId);
  if (member === undefined) return [];
  // An archived project is readable and nothing else. Archiving is meant to be
  // reversible, so the reopen path is granted separately by `archive_project`.
  if (project.status === 'ARCHIVED') {
    return WONDERLAND_ROLE_CAPABILITIES[member.role].filter(
      (capability) => capability === 'view_project' || capability === 'archive_project',
    );
  }
  return WONDERLAND_ROLE_CAPABILITIES[member.role];
}

export function hasCapability(
  project: WonderlandProjectDraft,
  userId: string,
  capability: WonderlandProjectCapability,
): boolean {
  return capabilitiesFor(project, userId).includes(capability);
}

/** The count that the five-collaborator ceiling is measured against. */
export function collaboratorCount(project: WonderlandProjectDraft): number {
  return project.members.length;
}
