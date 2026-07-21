import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { RelayMission, RelayResult } from '../domain/types';
import {
  createMission as buildMission,
  nextAction,
  type MissionDraft,
} from '../domain/stages';
import {
  generateImplementerHandoff,
  generateRepairTask,
  generateReviewBrief,
} from '../domain/briefs';
import {
  parseImplementationReport,
  parseRepairReport,
  parseReview,
  parseTestEvidence,
} from '../domain/ingest';
import { verifyMission } from '../domain/gate';

/**
 * Relay store — isolated from the Alcatraz session store by design:
 * its own zustand instance, its own localStorage key (sunday.relay.v1),
 * no imports from src/state/**. All mutations flow through guarded actions
 * that append a ledger event; a verified mission is immutable.
 */

export const RELAY_STORAGE_KEY = 'sunday.relay.v1';

let clock: () => string = () => new Date().toISOString();
let idFactory: () => string = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m-${Math.random().toString(36).slice(2, 10)}`;

export function setRelayClockForTest(fn: (() => string) | null) {
  clock = fn ?? (() => new Date().toISOString());
}
export function setRelayIdFactoryForTest(fn: (() => string) | null) {
  idFactory =
    fn ??
    (() =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `m-${Math.random().toString(36).slice(2, 10)}`);
}

export interface RelayState {
  missions: RelayMission[];
  activeMissionId: string | null;
  createMission: (draft: MissionDraft) => RelayResult<string>;
  selectMission: (id: string | null) => void;
  deleteMission: (id: string) => void;
  /** Seeds a pre-recorded mission (labeled Recorded in the UI). */
  addMission: (mission: RelayMission) => void;
  generateHandoff: (missionId: string) => RelayResult<null>;
  ingestImplementationReport: (missionId: string, text: string) => RelayResult<null>;
  generateReviewBrief: (missionId: string) => RelayResult<null>;
  ingestReview: (missionId: string, text: string) => RelayResult<null>;
  generateRepairTask: (missionId: string) => RelayResult<null>;
  ingestRepairReport: (missionId: string, text: string) => RelayResult<null>;
  ingestEvidence: (missionId: string, text: string) => RelayResult<null>;
  markVerified: (missionId: string) => RelayResult<null>;
}

const ok: RelayResult<null> = { ok: true, value: null };
const fail = (...errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });

/** In-memory fallback keeps the store working where localStorage is absent
 * (tests, SSR-ish tooling) without touching any shared storage helper. */
function relayStorage(): Storage {
  if (typeof localStorage !== 'undefined') return localStorage;
  const mem = new Map<string, string>();
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    get length() {
      return mem.size;
    },
  } as Storage;
}

export const useRelayStore = create<RelayState>()(
  persist(
    (set, get) => {
      /** Apply fn to the mission; refuse if missing or already verified. */
      function withMission(
        missionId: string,
        fn: (m: RelayMission, at: string) => RelayResult<RelayMission>,
      ): RelayResult<null> {
        const mission = get().missions.find((m) => m.id === missionId);
        if (!mission) return fail('Mission not found.');
        if (mission.verification) return fail('Mission is verified and immutable.');
        const at = clock();
        const result = fn(mission, at);
        if (!result.ok) return result;
        set((s) => ({
          missions: s.missions.map((m) => (m.id === missionId ? result.value : m)),
        }));
        return ok;
      }

      const logged = (
        m: RelayMission,
        at: string,
        stage: RelayMission['ledger'][number]['stage'],
        summary: string,
        patch: Partial<RelayMission>,
      ): RelayMission => ({
        ...m,
        ...patch,
        ledger: [...m.ledger, { at, stage, summary }],
      });

      return {
        missions: [],
        activeMissionId: null,

        createMission: (draft) => {
          const at = clock();
          const built = buildMission(draft, { id: idFactory(), at });
          if (!built.ok) return built;
          set((s) => ({
            missions: [...s.missions, built.value],
            activeMissionId: built.value.id,
          }));
          return { ok: true, value: built.value.id };
        },

        selectMission: (id) => set({ activeMissionId: id }),

        deleteMission: (id) =>
          set((s) => ({
            missions: s.missions.filter((m) => m.id !== id),
            activeMissionId: s.activeMissionId === id ? null : s.activeMissionId,
          })),

        addMission: (mission) =>
          set((s) => ({
            missions: [...s.missions.filter((m) => m.id !== mission.id), mission],
            activeMissionId: mission.id,
          })),

        generateHandoff: (missionId) =>
          withMission(missionId, (m, at) => {
            if (m.handoff) return fail('Handoff already generated.');
            const handoff = generateImplementerHandoff(m, at);
            return {
              ok: true,
              value: logged(m, at, 'handoff', 'Implementer handoff generated.', { handoff }),
            };
          }),

        ingestImplementationReport: (missionId, text) =>
          withMission(missionId, (m, at) => {
            if (!m.handoff) return fail('Generate the implementer handoff first.');
            if (m.review) {
              return fail('A review already exists — the implementation report is frozen.');
            }
            const parsed = parseImplementationReport(text, at);
            if (!parsed.ok) return parsed;
            return {
              ok: true,
              value: logged(
                m,
                at,
                'implementation',
                `Implementation report received from ${parsed.value.agent}.`,
                { implementationReport: parsed.value },
              ),
            };
          }),

        generateReviewBrief: (missionId) =>
          withMission(missionId, (m, at) => {
            const brief = generateReviewBrief(m, at);
            if (!brief.ok) return brief;
            return {
              ok: true,
              value: logged(m, at, 'review', 'Review brief generated for the independent reviewer.', {
                reviewBrief: brief.value,
              }),
            };
          }),

        ingestReview: (missionId, text) =>
          withMission(missionId, (m, at) => {
            if (!m.implementationReport) {
              return fail('Ingest the implementation report before the review.');
            }
            if (m.repairTask || m.repairReport || m.evidence) {
              return fail('Later artifacts exist — the review is frozen.');
            }
            const parsed = parseReview(text, at);
            if (!parsed.ok) return parsed;
            return {
              ok: true,
              value: logged(
                m,
                at,
                'review',
                `Independent review received from ${parsed.value.reviewer}: ${parsed.value.verdict}, ${parsed.value.findings.length} finding(s).`,
                { review: parsed.value },
              ),
            };
          }),

        generateRepairTask: (missionId) =>
          withMission(missionId, (m, at) => {
            if (m.repairTask) return fail('Repair task already generated.');
            const task = generateRepairTask(m, at);
            if (!task.ok) return task;
            return {
              ok: true,
              value: logged(
                m,
                at,
                'repair-task',
                `Repair task generated for ${task.value.findingIds?.length ?? 0} finding(s).`,
                { repairTask: task.value },
              ),
            };
          }),

        ingestRepairReport: (missionId, text) =>
          withMission(missionId, (m, at) => {
            if (!m.repairTask) return fail('Generate the repair task first.');
            if (m.evidence) return fail('Evidence already recorded — the repair report is frozen.');
            const parsed = parseRepairReport(text, at);
            if (!parsed.ok) return parsed;
            return {
              ok: true,
              value: logged(
                m,
                at,
                'repair',
                `Repair completion received from ${parsed.value.agent} (${parsed.value.resolvedFindings.length} resolution(s)).`,
                { repairReport: parsed.value },
              ),
            };
          }),

        ingestEvidence: (missionId, text) =>
          withMission(missionId, (m, at) => {
            const action = nextAction(m);
            if (action.type !== 'ingest-evidence' && !m.evidence) {
              return fail(`Evidence is not the next step (next: ${action.type}).`);
            }
            const parsed = parseTestEvidence(text, at);
            if (!parsed.ok) return parsed;
            return {
              ok: true,
              value: logged(
                m,
                at,
                'evidence',
                `Test evidence recorded: ${parsed.value.entries.length} command run(s).`,
                { evidence: parsed.value },
              ),
            };
          }),

        markVerified: (missionId) =>
          withMission(missionId, (m, at) => {
            const gate = verifyMission(m);
            if (!gate.ok) {
              return fail(
                ...gate.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`),
              );
            }
            return {
              ok: true,
              value: logged(m, at, 'verified', 'Verification gate passed — mission verified complete.', {
                verification: { at, ok: true, checks: gate.checks },
              }),
            };
          }),
      };
    },
    {
      name: RELAY_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(relayStorage),
      partialize: (s) => ({ missions: s.missions, activeMissionId: s.activeMissionId }),
    },
  ),
);
