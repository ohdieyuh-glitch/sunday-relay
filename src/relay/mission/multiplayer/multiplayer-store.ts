import { digestOf } from '../durable/durable-digest';
import type { DurableKeyValueBacking } from '../durable/durable-store';
import {
  SUPPORTED_WONDERLAND_SESSION_SCHEMA_VERSIONS,
  WONDERLAND_SESSION_STATUSES,
  type WonderlandSession,
  type WonderlandSessionDraft,
} from './multiplayer-contracts';

/**
 * THE SESSION STORE.
 *
 * A session is durable so that a RECONNECT can outlive the process that served
 * the first connection — which is the whole point of holding a slot. Same
 * backing seam as every other durable record here.
 */

export function sealWonderlandSession(
  draft: WonderlandSessionDraft | WonderlandSession,
): WonderlandSession {
  const { checksum: _stale, ...rest } = draft as WonderlandSession;
  return { ...rest, checksum: digestOf(rest) };
}

export function wonderlandSessionDraftFrom(record: WonderlandSession): WonderlandSessionDraft {
  const { checksum: _checksum, ...rest } = record;
  return rest;
}

export type WonderlandSessionReadResult =
  | { readonly ok: true; readonly record: WonderlandSession }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'corrupt'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unsupported_version'; readonly detail: string };

export function readWonderlandSession(raw: unknown): WonderlandSessionReadResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'corrupt', detail: 'stored session is not an object' };
  }
  const candidate = raw as Record<string, unknown>;
  const version = candidate.schemaVersion;
  if (typeof version !== 'string') {
    return { ok: false, reason: 'corrupt', detail: 'stored session declares no schema version' };
  }
  if (!(SUPPORTED_WONDERLAND_SESSION_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return { ok: false, reason: 'unsupported_version', detail: version };
  }
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored session has no id' };
  }
  if (typeof candidate.hostUserId !== 'string' || candidate.hostUserId === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored session names no host' };
  }
  if (
    typeof candidate.status !== 'string' ||
    !(WONDERLAND_SESSION_STATUSES as readonly string[]).includes(candidate.status)
  ) {
    return { ok: false, reason: 'corrupt', detail: 'stored session has an unknown status' };
  }
  // The participant list IS the authorization answer for a session. A malformed
  // one must never read as an empty world that anybody may walk into.
  if (!Array.isArray(candidate.participants)) {
    return { ok: false, reason: 'corrupt', detail: 'stored session has a malformed participant list' };
  }
  if (typeof candidate.checksum !== 'string' || candidate.checksum === '') {
    return { ok: false, reason: 'corrupt', detail: 'stored session carries no checksum' };
  }
  const record = candidate as unknown as WonderlandSession;
  const { checksum, ...rest } = record;
  if (digestOf(rest) !== checksum) {
    return { ok: false, reason: 'corrupt', detail: 'stored session failed its checksum' };
  }
  return { ok: true, record };
}

export interface WonderlandSessionStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  read(sessionId: string): Promise<WonderlandSessionReadResult>;
  write(draft: WonderlandSessionDraft): Promise<{ ok: boolean; record?: WonderlandSession; reason?: string }>;
  /** Find an OPEN session by the code a host read aloud. */
  findByJoinCode(joinCode: string): Promise<WonderlandSession | null>;
  listAllIds(): Promise<readonly string[]>;
  remove(sessionId: string): Promise<void>;
}

const KEY_PREFIX = 'wonderland-session:';
const keyFor = (sessionId: string): string => `${KEY_PREFIX}${sessionId}`;

export function createWonderlandSessionStore(
  backing: DurableKeyValueBacking,
): WonderlandSessionStorePort {
  const readOne = async (sessionId: string): Promise<WonderlandSessionReadResult> => {
    let text: string | null;
    try {
      text = await backing.getText(keyFor(sessionId));
    } catch (error) {
      return { ok: false, reason: 'corrupt', detail: safeReason(error) };
    }
    if (text === null) return { ok: false, reason: 'not_found' };
    try {
      return readWonderlandSession(JSON.parse(text));
    } catch {
      return { ok: false, reason: 'corrupt', detail: 'stored session is not valid JSON' };
    }
  };

  const allIds = async (): Promise<readonly string[]> => {
    try {
      const keys = await backing.listKeys();
      return keys.filter((k) => k.startsWith(KEY_PREFIX)).map((k) => k.slice(KEY_PREFIX.length));
    } catch {
      return [];
    }
  };

  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,
    read: readOne,

    async write(draft) {
      const record = sealWonderlandSession(draft);
      try {
        await backing.putText(keyFor(record.sessionId), JSON.stringify(record));
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
      return { ok: true, record };
    },

    async findByJoinCode(joinCode) {
      for (const id of await allIds()) {
        const result = await readOne(id);
        // A closed session is not joinable, so its code resolves to nothing
        // rather than to a session that will refuse on the next call.
        if (result.ok && result.record.joinCode === joinCode && result.record.status !== 'CLOSED') {
          return result.record;
        }
      }
      return null;
    },

    listAllIds: allIds,

    async remove(sessionId) {
      try {
        await backing.deleteKey(keyFor(sessionId));
      } catch {
        /* already gone */
      }
    },
  };
}

function safeReason(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    const message = error.message.slice(0, 200);
    return message.length > 0 ? message : 'durable session write failed';
  }
  return 'durable session write failed';
}
