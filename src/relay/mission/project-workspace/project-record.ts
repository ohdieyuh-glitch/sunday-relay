import { digestOf } from '../durable/durable-digest';
import {
  SUPPORTED_WONDERLAND_PROJECT_SCHEMA_VERSIONS,
  WONDERLAND_PROJECT_STATUSES,
  type WonderlandProject,
  type WonderlandProjectDraft,
} from './project-contracts';

/**
 * Turning stored bytes into a trusted project — version, then shape, then
 * checksum, and no failure converted into "there is no project".
 *
 * This matters more here than anywhere else in the session. A creation can be
 * rebuilt and a session can be rejoined, but a project IS the user's work. A
 * read path that returned `null` on a shape it did not recognize would present
 * a Monday of effort as though it had never happened, and the user would have no
 * way to tell that from real loss. So an unreadable project is reported as
 * unreadable, KEPT on disk, and never auto-deleted.
 */

export function sealWonderlandProject(
  draft: WonderlandProjectDraft | WonderlandProject,
): WonderlandProject {
  const { checksum: _stale, ...rest } = draft as WonderlandProject;
  return { ...rest, checksum: digestOf(rest) };
}

export function wonderlandProjectDraftFrom(record: WonderlandProject): WonderlandProjectDraft {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

export function verifyWonderlandProjectChecksum(record: WonderlandProject): boolean {
  const { checksum, ...rest } = record;
  return typeof checksum === 'string' && checksum.length > 0 && digestOf(rest) === checksum;
}

export type WonderlandProjectReadResult =
  | { readonly ok: true; readonly record: WonderlandProject }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

const isString = (value: unknown): value is string => typeof value === 'string';

export function readWonderlandProject(raw: unknown): WonderlandProjectReadResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored project is not an object' };
  }
  const candidate = raw as Record<string, unknown>;

  const version = candidate.schemaVersion;
  if (!isString(version)) {
    return { ok: false, reason: 'corrupt', detail: 'stored project declares no schema version' };
  }
  if (!(SUPPORTED_WONDERLAND_PROJECT_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return { ok: false, reason: 'unsupported_version', detail: version };
  }
  if (!isString(candidate.projectId) || candidate.projectId === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored project has no id' };
  }
  if (!isString(candidate.ownerUserId) || candidate.ownerUserId === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored project names no owning account' };
  }
  if (!isString(candidate.status) || !(WONDERLAND_PROJECT_STATUSES as readonly string[]).includes(candidate.status)) {
    return { ok: false, reason: 'corrupt', detail: `stored project has an unknown status: ${String(candidate.status)}` };
  }
  // The member list is the ENTIRE authorization answer for this project. A
  // malformed one must never read as "no members", which would look like a
  // correctly-denied project rather than a corrupt one.
  if (!Array.isArray(candidate.members) || candidate.members.length === 0) {
    return { ok: false, reason: 'corrupt', detail: 'stored project carries no membership' };
  }
  for (const listField of ['files', 'assets', 'creationIds', 'missionIds'] as const) {
    if (!Array.isArray(candidate[listField])) {
      return { ok: false, reason: 'corrupt', detail: `stored project has a malformed ${listField}` };
    }
  }
  if (candidate.avatar === null || typeof candidate.avatar !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored project has no Project Avatar' };
  }
  if (typeof candidate.version !== 'number' || !Number.isFinite(candidate.version)) {
    return { ok: false, reason: 'corrupt', detail: 'stored project has no usable version counter' };
  }
  if (!isString(candidate.checksum) || candidate.checksum === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored project carries no checksum' };
  }

  const record = candidate as unknown as WonderlandProject;
  if (!verifyWonderlandProjectChecksum(record)) {
    return { ok: false, reason: 'corrupt', detail: 'stored project failed its checksum' };
  }
  return { ok: true, record };
}
