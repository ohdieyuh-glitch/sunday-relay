import { digestOf } from '../durable/durable-digest';
import {
  SUPPORTED_WONDER_WEB_SCHEMA_VERSIONS,
  WONDER_WEB_CREATION_STATUSES,
  type WonderWebCreation,
  type WonderWebCreationDraft,
} from './wonder-web-contracts';

/**
 * WONDER WEB — turning stored bytes into a trusted creation.
 *
 * The order is VERSION, then SHAPE, then CHECKSUM, and no failure along the way
 * is ever converted into "there is no creation". A user who built something on
 * Monday and finds it missing on Tuesday because a field moved has lost work as
 * far as they are concerned, so an unreadable record is reported as unreadable
 * and KEPT. That is the same rule the durable mission record and the mission
 * worktree record already follow, and it is the reason this file exists rather
 * than a `JSON.parse` at each call site.
 */

/** Sha-256 over every field but the checksum. Same digest the Node layer writes. */
function digestFor(draft: WonderWebCreationDraft): string {
  return digestOf(draft);
}

/** Seal a draft into a stored record. The ONLY place a checksum is written. */
export function sealWonderWebCreation(
  draft: WonderWebCreationDraft | WonderWebCreation,
): WonderWebCreation {
  const { checksum: _stale, ...rest } = draft as WonderWebCreation;
  return { ...rest, checksum: digestFor(rest) };
}

/** Continue from a stored record without carrying its now-stale checksum. */
export function wonderWebDraftFrom(record: WonderWebCreation): WonderWebCreationDraft {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

export function verifyWonderWebChecksum(record: WonderWebCreation): boolean {
  const { checksum, ...rest } = record;
  return typeof checksum === 'string' && checksum.length > 0 && digestFor(rest) === checksum;
}

export type WonderWebReadResult =
  | { readonly ok: true; readonly record: WonderWebCreation }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

const isString = (value: unknown): value is string => typeof value === 'string';
const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/**
 * The only way stored bytes become a trusted `WonderWebCreation`.
 *
 * Shape checking is deliberately shallow-but-real: the fields every downstream
 * decision reads — owner, status, entrypoint, version — are checked, because a
 * record missing `ownerUserId` would otherwise reach the authorization layer as
 * `undefined` and compare unequal to every user, which looks like a correct
 * denial and is actually a corrupt record nobody noticed.
 */
export function readWonderWebCreation(raw: unknown): WonderWebReadResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored creation is not an object' };
  }
  const candidate = raw as Record<string, unknown>;

  const version = candidate.schemaVersion;
  if (!isString(version)) {
    return { ok: false, reason: 'corrupt', detail: 'stored creation declares no schema version' };
  }
  if (!(SUPPORTED_WONDER_WEB_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return { ok: false, reason: 'unsupported_version', detail: version };
  }
  if (!isString(candidate.creationId) || candidate.creationId === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored creation has no id' };
  }
  if (!isString(candidate.ownerUserId) || candidate.ownerUserId === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored creation names no owning account' };
  }
  if (!isString(candidate.status) || !(WONDER_WEB_CREATION_STATUSES as readonly string[]).includes(candidate.status)) {
    return { ok: false, reason: 'corrupt', detail: `stored creation has an unknown status: ${String(candidate.status)}` };
  }
  if (candidate.entrypoint !== null && !isString(candidate.entrypoint)) {
    return { ok: false, reason: 'corrupt', detail: 'stored creation has a malformed entrypoint' };
  }
  if (typeof candidate.version !== 'number' || !Number.isFinite(candidate.version)) {
    return { ok: false, reason: 'corrupt', detail: 'stored creation has no usable version counter' };
  }
  for (const listField of ['sourceFiles', 'buildArtifacts', 'logs', 'errors'] as const) {
    if (!isArray(candidate[listField])) {
      return { ok: false, reason: 'corrupt', detail: `stored creation has a malformed ${listField}` };
    }
  }
  if (!isString(candidate.checksum) || candidate.checksum === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored creation carries no checksum' };
  }

  const record = candidate as unknown as WonderWebCreation;
  if (!verifyWonderWebChecksum(record)) {
    return { ok: false, reason: 'corrupt', detail: 'stored creation failed its checksum' };
  }
  return { ok: true, record };
}
