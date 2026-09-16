import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  WONDERLAND_PROJECT_MAX_COLLABORATORS,
  WONDERLAND_PROJECT_SCHEMA_VERSION,
  capabilitiesFor,
  hasCapability,
  type WonderlandProjectAsset,
  type WonderlandProjectDraft,
  type WonderlandProjectFile,
  type WonderlandProjectRole,
} from './project-contracts';

/**
 * THE PROJECT OPERATIONS.
 *
 * CREATE, OPEN, SAVE, RENAME, DUPLICATE, ARCHIVE, REOPEN — plus the file and
 * membership operations a workspace needs. Every one is pure, total, and
 * authorization-checked against the caller's capabilities, so a surface cannot
 * reach a mutation by calling a different function.
 *
 * AUTHORIZATION IS NOT OPTIONAL AND NOT A PARAMETER TO FORGET. Every mutating
 * function takes `actorUserId` as a REQUIRED argument and refuses before it
 * mutates. There is no variant without it, because the variant without it is
 * what every surface would reach for.
 *
 * ACTOR ATTRIBUTION travels with the change: the member record carries who added
 * it, and `updatedAt` moves on every accepted mutation. "Who did it is part of
 * the record, always" is the founder's wording, and it is cheap to keep.
 */

/** A path a project file may occupy. Same rule as a creation path. */
export function isSafeProjectPath(path: string): boolean {
  if (path === '' || path.trim() !== path) return false;
  if (path.includes('\\') || path.includes('\0')) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split('/').some((segment) => segment === '..' || segment === '');
}

/** Deterministic, stable, and derived — the same project always looks itself. */
export function avatarFormHint(projectId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < projectId.length; i++) {
    hash = Math.imul(hash ^ projectId.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `form-${(hash % 12) + 1}`;
}

function touch(project: WonderlandProjectDraft, atIso: string): WonderlandProjectDraft {
  return {
    ...project,
    updatedAt: atIso,
    version: project.version + 1,
    avatar: { ...project.avatar, status: project.status, updatedAtIso: atIso },
  };
}

function requireCapability(
  project: WonderlandProjectDraft,
  actorUserId: string,
  capability: Parameters<typeof hasCapability>[2],
): RelayResult<null> {
  if (hasCapability(project, actorUserId, capability)) return ok(null);
  return fail(
    relayError('permission-denied', `This account may not ${capability.replace(/_/g, ' ')} in this project.`, {
      entityIds: { projectId: project.projectId, actorUserId },
    }),
  );
}

/* --------------------------------------------------------------- create */

export interface CreateProjectInput {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAtIso: string;
  readonly brainRef?: string | null;
}

/**
 * CREATE PROJECT. The owner is seated as `project_leader` in the same act — a
 * project with no leader would be a project nobody can administer.
 */
export function createWonderlandProject(
  input: CreateProjectInput,
): RelayResult<WonderlandProjectDraft> {
  if (input.projectId.trim() === '') {
    return fail(relayError('validation-failed', 'A project needs an id.'));
  }
  if (input.ownerUserId.trim() === '') {
    return fail(relayError('validation-failed', 'A project must name the account that owns it.'));
  }
  const name = input.name.trim();
  if (name === '') {
    return fail(relayError('validation-failed', 'A project needs a name.'));
  }
  return ok({
    schemaVersion: WONDERLAND_PROJECT_SCHEMA_VERSION,
    projectId: input.projectId,
    ownerUserId: input.ownerUserId,
    name,
    description: input.description?.trim() ?? '',
    status: 'ACTIVE',
    createdAt: input.createdAtIso,
    updatedAt: input.createdAtIso,
    members: [
      {
        userId: input.ownerUserId,
        role: 'project_leader',
        addedAtIso: input.createdAtIso,
        addedByUserId: input.ownerUserId,
      },
    ],
    files: [],
    assets: [],
    creationIds: [],
    missionIds: [],
    avatar: {
      avatarId: `avatar_${input.projectId}`,
      projectId: input.projectId,
      ownerUserId: input.ownerUserId,
      displayName: name,
      manifestation: 'placeholder_sigil',
      formHint: avatarFormHint(input.projectId),
      status: 'ACTIVE',
      updatedAtIso: input.createdAtIso,
    },
    brainRef: input.brainRef ?? null,
    version: 1,
    checksum: '',
  } as WonderlandProjectDraft);
}

/* ----------------------------------------------------------------- open */

export type ProjectOpenResult =
  | { readonly ok: true; readonly project: WonderlandProjectDraft }
  | { readonly ok: false; readonly reason: 'not_a_member' | 'archived' };

/**
 * OPEN PROJECT. A read, so it mutates nothing — but it still refuses a
 * non-member, because "can I see it" is the first authorization question and
 * answering it anywhere else would mean answering it in several places.
 */
export function openWonderlandProject(
  project: WonderlandProjectDraft,
  actorUserId: string,
): ProjectOpenResult {
  if (!hasCapability(project, actorUserId, 'view_project')) {
    return { ok: false, reason: 'not_a_member' };
  }
  // An archived project opens READ-ONLY rather than refusing: a user returning
  // to old work should see it, and reopening is one deliberate act away.
  return { ok: true, project };
}

/* --------------------------------------------------------------- rename */

export function renameWonderlandProject(
  project: WonderlandProjectDraft,
  actorUserId: string,
  name: string,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'change_configuration');
  if (!allowed.ok) return allowed;
  const trimmed = name.trim();
  if (trimmed === '') {
    return fail(relayError('validation-failed', 'A project name cannot be empty.'));
  }
  const renamed = touch({ ...project, name: trimmed }, atIso);
  return ok({ ...renamed, avatar: { ...renamed.avatar, displayName: trimmed } });
}

/* ------------------------------------------------------------- duplicate */

/**
 * DUPLICATE PROJECT. Files and assets are copied; CREATIONS AND MISSIONS ARE
 * NOT.
 *
 * A creation belongs to the run that produced it and carries its own provenance
 * and build state; copying the id into a second project would give two projects
 * the same creation and let either one rebuild it. The copy therefore starts
 * with the work and none of the history, which is what "duplicate" honestly
 * means here. Members are not copied either — the duplicate belongs to whoever
 * made it.
 */
export function duplicateWonderlandProject(
  project: WonderlandProjectDraft,
  actorUserId: string,
  newProjectId: string,
  newName: string,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'view_project');
  if (!allowed.ok) return allowed;

  const created = createWonderlandProject({
    projectId: newProjectId,
    ownerUserId: actorUserId,
    name: newName,
    description: project.description,
    createdAtIso: atIso,
    brainRef: null,
  });
  if (!created.ok) return created;

  return ok({
    ...created.value,
    files: project.files.map((file) => ({ ...file, updatedAtIso: atIso })),
    assets: project.assets.map((asset) => ({ ...asset, updatedAtIso: atIso })),
  });
}

/* --------------------------------------------------------- archive/reopen */

export function archiveWonderlandProject(
  project: WonderlandProjectDraft,
  actorUserId: string,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'archive_project');
  if (!allowed.ok) return allowed;
  if (project.status === 'ARCHIVED') {
    return fail(relayError('illegal-transition', 'This project is already archived.'));
  }
  return ok(touch({ ...project, status: 'ARCHIVED' }, atIso));
}

export function reopenWonderlandProject(
  project: WonderlandProjectDraft,
  actorUserId: string,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'archive_project');
  if (!allowed.ok) return allowed;
  if (project.status === 'ACTIVE') {
    return fail(relayError('illegal-transition', 'This project is already open.'));
  }
  return ok(touch({ ...project, status: 'ACTIVE' }, atIso));
}

/* ------------------------------------------------------------------ save */

/**
 * SAVE a file into the workspace.
 *
 * Saving an existing path REPLACES it and increments that path's revision, so a
 * user can see that Tuesday's save is the third version of Monday's file. The
 * project's own `version` moves too, which is what a client compares to know its
 * view is stale.
 */
export function saveProjectFile(
  project: WonderlandProjectDraft,
  actorUserId: string,
  file: Omit<WonderlandProjectFile, 'revision' | 'updatedAtIso'>,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'edit_files');
  if (!allowed.ok) return allowed;
  if (!isSafeProjectPath(file.path)) {
    return fail(
      relayError('validation-failed', 'That path escapes the project workspace.', {
        details: [file.path],
      }),
    );
  }
  const existing = project.files.find((candidate) => candidate.path === file.path);
  const saved: WonderlandProjectFile = {
    ...file,
    updatedAtIso: atIso,
    revision: (existing?.revision ?? 0) + 1,
  };
  const files = existing === undefined
    ? [...project.files, saved]
    : project.files.map((candidate) => (candidate.path === file.path ? saved : candidate));
  return ok(touch({ ...project, files }, atIso));
}

export function saveProjectAsset(
  project: WonderlandProjectDraft,
  actorUserId: string,
  asset: Omit<WonderlandProjectAsset, 'revision' | 'updatedAtIso'>,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'edit_files');
  if (!allowed.ok) return allowed;
  if (!isSafeProjectPath(asset.path)) {
    return fail(relayError('validation-failed', 'That path escapes the project workspace.'));
  }
  const existing = project.assets.find((candidate) => candidate.path === asset.path);
  const saved: WonderlandProjectAsset = {
    ...asset,
    updatedAtIso: atIso,
    revision: (existing?.revision ?? 0) + 1,
  };
  const assets = existing === undefined
    ? [...project.assets, saved]
    : project.assets.map((candidate) => (candidate.path === asset.path ? saved : candidate));
  return ok(touch({ ...project, assets }, atIso));
}

export function removeProjectFile(
  project: WonderlandProjectDraft,
  actorUserId: string,
  path: string,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'edit_files');
  if (!allowed.ok) return allowed;
  const files = project.files.filter((candidate) => candidate.path !== path);
  if (files.length === project.files.length) {
    return fail(relayError('not-found', 'No such file in this project.', { details: [path] }));
  }
  return ok(touch({ ...project, files }, atIso));
}

/* ------------------------------------------------- creations and missions */

/**
 * SAVE A CREATION INTO THE PROJECT.
 *
 * This is the step that makes a creation durable work rather than a build
 * artifact: the temporary build directory is NOT the canonical project, and
 * attaching the creation here is what says so. Only the id is stored — the
 * creation record itself stays in the Wonder Web store.
 */
export function attachCreationToProject(
  project: WonderlandProjectDraft,
  actorUserId: string,
  creationId: string,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'edit_files');
  if (!allowed.ok) return allowed;
  if (project.creationIds.includes(creationId)) {
    // Idempotent: saving the same creation twice is not an error, and it must
    // not append a duplicate id that a later reader would count twice.
    return ok(project);
  }
  return ok(touch({ ...project, creationIds: [...project.creationIds, creationId] }, atIso));
}

export function attachMissionToProject(
  project: WonderlandProjectDraft,
  actorUserId: string,
  missionId: string,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'create_mission');
  if (!allowed.ok) return allowed;
  if (project.missionIds.includes(missionId)) return ok(project);
  return ok(touch({ ...project, missionIds: [...project.missionIds, missionId] }, atIso));
}

/* ------------------------------------------------------------- membership */

export function addProjectCollaborator(
  project: WonderlandProjectDraft,
  actorUserId: string,
  userId: string,
  role: WonderlandProjectRole,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'manage_collaborators');
  if (!allowed.ok) return allowed;
  if (project.members.some((member) => member.userId === userId)) {
    return fail(relayError('validation-failed', 'That account is already a collaborator.'));
  }
  if (project.members.length >= WONDERLAND_PROJECT_MAX_COLLABORATORS) {
    return fail(
      relayError('validation-failed', `A project holds at most ${WONDERLAND_PROJECT_MAX_COLLABORATORS} collaborators.`),
    );
  }
  return ok(
    touch(
      {
        ...project,
        members: [...project.members, { userId, role, addedAtIso: atIso, addedByUserId: actorUserId }],
      },
      atIso,
    ),
  );
}

/**
 * REMOVE a collaborator. Access does not leak afterwards because every
 * authorization answer is DERIVED from this list on each call — there is no
 * cached grant, no issued token and no capability copy to revoke separately.
 */
export function removeProjectCollaborator(
  project: WonderlandProjectDraft,
  actorUserId: string,
  userId: string,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'manage_collaborators');
  if (!allowed.ok) return allowed;
  if (userId === project.ownerUserId) {
    return fail(relayError('permission-denied', 'The owning account cannot be removed from its own project.'));
  }
  const members = project.members.filter((member) => member.userId !== userId);
  if (members.length === project.members.length) {
    return fail(relayError('not-found', 'That account is not a collaborator here.'));
  }
  return ok(touch({ ...project, members }, atIso));
}

export function changeCollaboratorRole(
  project: WonderlandProjectDraft,
  actorUserId: string,
  userId: string,
  role: WonderlandProjectRole,
  atIso: string,
): RelayResult<WonderlandProjectDraft> {
  const allowed = requireCapability(project, actorUserId, 'manage_collaborators');
  if (!allowed.ok) return allowed;
  if (userId === project.ownerUserId && role !== 'project_leader') {
    return fail(
      relayError('permission-denied', 'The owning account remains the project leader.'),
    );
  }
  if (!project.members.some((member) => member.userId === userId)) {
    return fail(relayError('not-found', 'That account is not a collaborator here.'));
  }
  return ok(
    touch(
      {
        ...project,
        members: project.members.map((member) =>
          member.userId === userId ? { ...member, role } : member,
        ),
      },
      atIso,
    ),
  );
}

/** Exported for the authorization test, which walks every role. */
export { capabilitiesFor };
