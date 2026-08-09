import { isKnownBackdrop, type RelayBackdropId } from '../../shared/relay-stage-backdrop';
import { RELAY_APP_SCHEMA_VERSION, emptyRelayAppData } from './contracts';
import { isChakraTier, type ChakraTier } from '../../shared/relay-chakra';
import type { RelayAppData } from './contracts';

/**
 * Durable browser-demo persistence adapter — typed localStorage envelope.
 *
 * Chosen over IndexedDB deliberately: the demo dataset is small, access is
 * synchronous (no async races on boot), jsdom tests exercise it directly,
 * and there is no server in this worktree's frontend. The adapter boundary
 * means a future backend replaces this file, not the UI.
 *
 * Guarantees:
 *   - versioned envelope with a migration seam (schemaVersion)
 *   - malformed / truncated / wrong-shape data recovers to a clean state
 *     (never a crash, never a half-parsed store)
 *   - initialization is idempotent — reloading never duplicates projects
 *   - no credentials, tokens, or provider data are ever stored
 */

export const RELAY_APP_STORAGE_KEY = 'sunday-relay.app.v1';

export interface RelayAppStorage {
  load(): RelayAppData;
  save(data: RelayAppData): void;
  clear(): void;
}

/** Structural check — enough to reject foreign/corrupt payloads without
    trusting them. Anything failing recovers to the empty state. */
function isRelayAppData(value: unknown): value is RelayAppData {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === RELAY_APP_SCHEMA_VERSION &&
    Array.isArray(v.projects) &&
    typeof v.briefs === 'object' && v.briefs !== null &&
    typeof v.settings === 'object' && v.settings !== null &&
    typeof v.brains === 'object' && v.brains !== null &&
    typeof v.missions === 'object' && v.missions !== null &&
    typeof v.events === 'object' && v.events !== null &&
    (v.activeProjectId === null || typeof v.activeProjectId === 'string') &&
    (v.colorway === 'obsidian' || v.colorway === 'midnight' || v.colorway === 'manual')
    // `stageBackdrop` and `chakraTier` are DELIBERATELY NOT CHECKED HERE.
    // Requiring either would make every store written before the field existed
    // fail this check and recover to empty — discarding a user's real projects
    // to recover a piece of scenery. They are normalized on load instead,
    // below.
  );
}

/**
 * NORMALIZE THE SCENERY, rather than reject the store over it.
 *
 * Three cases collapse to the same safe answer, `null` (No scene): the field is
 * absent because an older build wrote this payload; the field names a backdrop
 * THIS build does not have, which describes a newer or forked build; or it is
 * the wrong type entirely. Substituting a different scene would be the surface
 * deciding something the user did not — the rule `resolveBackdrop` already
 * holds — and dropping the whole store would cost far more than it recovers.
 */
function normalizeStageBackdrop(value: unknown): RelayBackdropId | null {
  return isKnownBackdrop(value) ? value : null;
}

export function createRelayAppStorage(backing?: Storage): RelayAppStorage {
  const store: Storage | null =
    backing ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);

  return {
    load(): RelayAppData {
      if (!store) return emptyRelayAppData();
      let raw: string | null = null;
      try {
        raw = store.getItem(RELAY_APP_STORAGE_KEY);
      } catch {
        return emptyRelayAppData(); // storage denied (private mode) — run in memory
      }
      if (raw === null) return emptyRelayAppData();
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isRelayAppData(parsed)) {
          return {
            ...parsed,
            stageBackdrop: normalizeStageBackdrop(
              (parsed as unknown as Record<string, unknown>).stageBackdrop,
            ),
            // Same rule, same reason: an absent, unknown or forked tier is NO
            // TIER, never root — substituting a level nobody chose is the one
            // thing a progression accent must not do.
            chakraTier: isChakraTier((parsed as unknown as Record<string, unknown>).chakraTier)
              ? ((parsed as unknown as Record<string, unknown>).chakraTier as ChakraTier)
              : null,
          };
        }
        // Future schema versions migrate here; unknown shapes recover clean.
        return emptyRelayAppData();
      } catch {
        // Malformed JSON: drop the corrupt payload so the next save heals it.
        try {
          store.removeItem(RELAY_APP_STORAGE_KEY);
        } catch {
          /* storage denied — memory only */
        }
        return emptyRelayAppData();
      }
    },

    save(data: RelayAppData): void {
      if (!store) return;
      try {
        store.setItem(RELAY_APP_STORAGE_KEY, JSON.stringify(data));
      } catch {
        /* quota/denied — the session continues in memory; nothing throws */
      }
    },

    clear(): void {
      try {
        store?.removeItem(RELAY_APP_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
