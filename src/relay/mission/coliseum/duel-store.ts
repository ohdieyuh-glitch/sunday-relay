/**
 * WONDERLAND COLISEUM — DURABLE STATE (PURE over the shared backing).
 *
 * Persists duel records and the per-agent XP LEDGER through the existing
 * `DurableKeyValueBacking` seam — the same key/value surface IndexedDB, a
 * filesystem directory and an in-memory Map all satisfy, so the browser and
 * Node behave identically on the same bytes.
 *
 * Every serialized record passes through the SHARED redactor
 * (`redactCommandMetadata`, the one mission/trace uses) before it is written,
 * so a token-named key can never reach durable storage.
 *
 * THE XP LEDGER IS APPEND-ONLY: an award is a new entry, never a rewrite. It
 * is the STORE for Relay's first progression source — nothing awards into it
 * yet; see the note in `src/relay/shared/relay-chakra.ts`.
 */

import type { DurableKeyValueBacking } from '../durable';
import { redactCommandMetadata } from '../trace/trace-redaction';
import { DUEL_STATUSES, type DuelRecord } from './duel-contracts';

const DUEL_PREFIX = 'coliseum:duel:';
const XP_PREFIX = 'coliseum:xp:';

/* -------------------------------------------------------------- xp ledger */

export interface XpLedgerEntry {
  readonly duelId: string;
  readonly xp: number;
  readonly awardedAt: string;
  readonly summary: string;
}

export interface AgentXpLedger {
  readonly agentId: string;
  /** Append-only, oldest first. */
  readonly entries: readonly XpLedgerEntry[];
}

export const totalXp = (ledger: AgentXpLedger): number =>
  ledger.entries.reduce((sum, e) => sum + e.xp, 0);

/* -------------------------------------------------------------------- port */

export interface DuelStoreWriteOk {
  readonly ok: true;
}
export interface DuelStoreWriteFailed {
  readonly ok: false;
  readonly reason: string;
}
export type DuelStoreWriteResult = DuelStoreWriteOk | DuelStoreWriteFailed;

export type DuelReadResult =
  | { readonly ok: true; readonly duel: DuelRecord }
  | { readonly ok: false; readonly reason: 'not_found' | 'corrupt' };

export interface DuelStorePort {
  readonly durability: 'durable' | 'volatile-test-only';
  readonly locationLabel: string;
  writeDuel(duel: DuelRecord): Promise<DuelStoreWriteResult>;
  readDuel(duelId: string): Promise<DuelReadResult>;
  listDuelIds(): Promise<readonly string[]>;
  /** Appends one XP award. History is never rewritten.
      CAUTION: implemented as a non-atomic read-modify-write of the whole
      ledger — two concurrent writers sharing one backing can lose an award
      (the known lock-race class; see relay-loop-worker's lock.ts note).
      Do not call this from two concurrent writers on a shared backing. */
  appendXp(agentId: string, entry: XpLedgerEntry): Promise<DuelStoreWriteResult>;
  readXpLedger(agentId: string): Promise<AgentXpLedger>;
}

export function createDuelStore(backing: DurableKeyValueBacking): DuelStorePort {
  return {
    durability: backing.durability,
    locationLabel: backing.locationLabel,

    async writeDuel(duel) {
      try {
        const redacted = redactCommandMetadata(
          duel as unknown as Record<string, unknown>,
        );
        await backing.putText(`${DUEL_PREFIX}${duel.duelId}`, JSON.stringify(redacted));
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
    },

    async readDuel(duelId) {
      let text: string | null;
      try {
        text = await backing.getText(`${DUEL_PREFIX}${duelId}`);
      } catch {
        return { ok: false, reason: 'corrupt' };
      }
      if (text === null) return { ok: false, reason: 'not_found' };
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, reason: 'corrupt' };
      }
      if (!looksLikeDuelRecord(parsed)) return { ok: false, reason: 'corrupt' };
      return { ok: true, duel: parsed };
    },

    async listDuelIds() {
      try {
        const keys = await backing.listKeys();
        return keys.filter((k) => k.startsWith(DUEL_PREFIX)).map((k) => k.slice(DUEL_PREFIX.length));
      } catch {
        return [];
      }
    },

    async appendXp(agentId, entry) {
      try {
        const existing = await this.readXpLedger(agentId);
        const next: AgentXpLedger = { agentId, entries: [...existing.entries, entry] };
        const redacted = redactCommandMetadata(next as unknown as Record<string, unknown>);
        await backing.putText(`${XP_PREFIX}${agentId}`, JSON.stringify(redacted));
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: safeReason(error) };
      }
    },

    async readXpLedger(agentId) {
      let text: string | null;
      try {
        text = await backing.getText(`${XP_PREFIX}${agentId}`);
      } catch {
        return { agentId, entries: [] };
      }
      if (text === null) return { agentId, entries: [] };
      try {
        const parsed = JSON.parse(text) as AgentXpLedger;
        return Array.isArray(parsed.entries) ? parsed : { agentId, entries: [] };
      } catch {
        return { agentId, entries: [] };
      }
    },
  };
}

function looksLikeDuelRecord(value: unknown): value is DuelRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<DuelRecord>;
  return (
    typeof record.duelId === 'string' &&
    typeof record.status === 'string' &&
    (DUEL_STATUSES as readonly string[]).includes(record.status) &&
    Array.isArray(record.participants) &&
    record.participants.length === 2
  );
}

function safeReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message.slice(0, 200);
  return 'durable write failed';
}
