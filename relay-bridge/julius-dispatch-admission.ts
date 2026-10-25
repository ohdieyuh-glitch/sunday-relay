import { parseJuliusAdmissionRunId } from '../scripts/julius-admission-run-id.mjs';

/**
 * The claim the J1 controller makes against an admission it does not own.
 * The store behind this port is BRIDGE. This file does not import it.
 *
 * `claim` moves `admitted` to `dispatched` once. A second claim of the same
 * pair is a replay. It does not open a new run. Both ids are recognized only
 * by `scripts/julius-admission-run-id.mjs`. This file does not mint either one.
 */

export function isClientRunId(value: string): boolean {
  const parsed = parseJuliusAdmissionRunId(value);
  return parsed.ok && parsed.form === 'wlj';
}

export function isServerRunId(value: string): boolean {
  const parsed = parseJuliusAdmissionRunId(value);
  return parsed.ok && parsed.form === 'legacy';
}

/** Either id of an admitted pair. Anything else is refused. */
export function isAdmittedRunId(value: string): boolean {
  return parseJuliusAdmissionRunId(value).ok;
}

export interface AdmittedRecord {
  readonly clientRunId: string;
  readonly serverRunId: string;
  readonly idempotencyKey: string;
  readonly missionId: string;
  readonly state: 'admitted';
}

export type AdmissionClaimResult =
  | { readonly ok: true; readonly dispatched: true; readonly replayed: boolean; readonly serverRunId: string }
  | { readonly ok: false; readonly reason: 'not_admitted' | 'mismatch' | 'already_terminal' };

export interface AdmissionClaimStore {
  /** Read the pair. Does not transition it. */
  read(presentedRunId: string): Promise<AdmittedRecord | null>;
  /** Atomically move admitted → dispatched exactly once. */
  claim(record: AdmittedRecord): Promise<AdmissionClaimResult>;
}

interface StoredAdmission extends AdmittedRecord {
  status: 'admitted' | 'dispatched' | 'terminal';
}

/** In-process store for tests. Production passes the BRIDGE admission port. */
export function createMemoryAdmissionStore(): AdmissionClaimStore & {
  admit(record: AdmittedRecord): void;
  status(presentedRunId: string): StoredAdmission['status'] | null;
  close(presentedRunId: string): void;
} {
  const rows = new Map<string, StoredAdmission>();
  const admit = (record: AdmittedRecord): void => {
    if (!isClientRunId(record.clientRunId) || !isServerRunId(record.serverRunId) || record.state !== 'admitted') {
      throw new Error('admission_record_invalid');
    }
    const stored: StoredAdmission = { ...record, status: 'admitted' };
    rows.set(record.clientRunId, stored);
    rows.set(record.serverRunId, stored);
  };
  return {
    admit,
    status(presentedRunId) { return rows.get(presentedRunId)?.status ?? null; },
    close(presentedRunId) {
      const row = rows.get(presentedRunId);
      if (row !== undefined) row.status = 'terminal';
    },
    async read(presentedRunId) {
      const row = rows.get(presentedRunId);
      if (row === undefined) return null;
      return { clientRunId: row.clientRunId, serverRunId: row.serverRunId, idempotencyKey: row.idempotencyKey, missionId: row.missionId, state: 'admitted' };
    },
    async claim(record) {
      const row = rows.get(record.clientRunId);
      if (row === undefined) return { ok: false, reason: 'not_admitted' };
      if (
        record.state !== 'admitted'
        || row.serverRunId !== record.serverRunId
        || row.idempotencyKey !== record.idempotencyKey
        || row.missionId !== record.missionId
        || row.clientRunId !== record.clientRunId
      ) return { ok: false, reason: 'mismatch' };
      if (row.status === 'terminal') return { ok: false, reason: 'already_terminal' };
      if (row.status === 'dispatched') return { ok: true, dispatched: true, replayed: true, serverRunId: row.serverRunId };
      row.status = 'dispatched';
      return { ok: true, dispatched: true, replayed: false, serverRunId: row.serverRunId };
    },
  };
}
