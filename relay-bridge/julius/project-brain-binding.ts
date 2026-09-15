import { isJuliusBrainId, juliusPrincipal, juliusWorkerPrincipal } from '../../src/relay/mission/julius/julius-brain-contracts';
import { resumeJuliusBrain } from '../../src/relay/mission/julius/julius-brain-export';
import { backfillJuliusBrainFromLegacy, createJuliusBrainMirroringWriter, type JuliusBrainMirrorReport } from '../../src/relay/mission/julius/julius-brain-legacy';
import type { JuliusBrainEntityState } from '../../src/relay/mission/julius/julius-brain-projection';
import { juliusBrainContextAsEntries } from '../../src/relay/mission/julius/julius-brain-query';
import { createJuliusProjectBrainService, defaultJuliusBrainReadGrant, type JuliusBrainHandle } from '../../src/relay/mission/julius/julius-brain-service';
import { compileJuliusBrainContextForMode, type JuliusBrainStateModePolicy } from '../../src/relay/mission/julius/julius-brain-state-modes';
import { readAllJuliusBrainEntities, type JuliusBrainStore } from '../../src/relay/mission/julius/julius-brain-store';
import type { JuliusBrainEntry, JuliusWorkerRole } from '../../src/relay/mission/julius/julius-runtime';
import type { JuliusBrainAppend, JuliusBrainWriter, JuliusClock, JuliusRunRow, JuliusRunWriter, JuliusRuntimeReader } from '../../src/relay/mission/julius/julius-runtime-ports';
import { juliusLegacyAppendAsStored } from '../../src/relay/persistence/julius-brain-legacy-postgres';

/**
 * PROJECT BRAIN v2 → THE LIVE JULIUS ROOT: THE PREPARED BINDING. NOT COMPOSED.
 *
 * Everything the live entrypoint (`relay-bridge/julius-live-mission.ts`) needs
 * for the first five steps of `docs/JULIUS_BRAIN_LIVE_INTEGRATION_PLAN.md`,
 * bound only to ports the live root already builds, so that wiring each step
 * is a few reviewed lines there rather than new machinery written under a
 * qualification deadline. Nothing imports this module yet, and nothing here
 * edits a frozen file:
 *
 *   bootstrap          create or open the project's Brain, refuse one whose
 *                      ledger or last checkpoint does not verify, and re-drive
 *                      the run's v1 entries (the bootstrap seed writes them
 *                      with SQL, past the writer port)
 *   wrapWriter         the v1 `JuliusBrainWriter`, mirrored into the ledger;
 *                      the v1 answer is returned unchanged and a mirror failure
 *                      never fails the mission
 *   wrapContextReader  the v1 `brainEntriesForRun`, plus the typed context the
 *                      run's STATE MODE admits — appended after v1's own entries
 *                      so the v1 compiler, which stops at the first entry that
 *                      overflows, always drops v2 before anything it had before
 *   checkpoint         pin the verified state at the end of a drive
 *
 * THE DEFAULT STATE MODE IS FRESH. v1 context is already run-scoped (the port
 * reads one run's entries), so FRESH is today's semantics: a run is shaped by
 * its own state and its mission's authority, never by an earlier run. Anything
 * wider is declared per run by `stateModeFor`.
 *
 * TYPED CONTEXT IS ALL OR NOTHING PER ROLE. If the budget would cut the
 * mission's authority, the role gets none of the v2 entries and the refusal
 * is reported; a partial set of requirements is worse than the v1 context
 * alone.
 */

export const JULIUS_LIVE_BRAIN_CONTEXT_ROLES: readonly JuliusWorkerRole[] = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];
export const JULIUS_LIVE_BRAIN_DEFAULT_CONTEXT_BUDGET = 4_000;

export function juliusProjectBrainIdFor(projectId: string): string {
  const brainId = `brain:${projectId}`;
  if (!isJuliusBrainId(brainId)) throw new Error('julius_project_brain_id_invalid');
  return brainId;
}

export type JuliusLiveBrainReport =
  | { readonly event: 'BOOTSTRAPPED'; readonly brainId: string; readonly runId: string; readonly created: boolean; readonly mirrored: number; readonly duplicates: number; readonly refused: number }
  | { readonly event: 'BOOTSTRAP_REFUSED'; readonly brainId: string; readonly runId: string; readonly problems: readonly string[] }
  | ({ readonly event: 'MIRROR' } & JuliusBrainMirrorReport)
  | {
    readonly event: 'CONTEXT'; readonly runId: string; readonly role: JuliusWorkerRole; readonly mode: string | null; readonly policyHash: string | null;
    readonly entries: number; readonly characters: number; readonly excluded: Readonly<Record<string, number>>;
    /** Why no typed context was added for this role, or null when it was. */
    readonly withheld: null | 'AUTHORITY_TRUNCATED' | 'RUN_NOT_FOUND' | `STATE_MODE_REFUSED:${string}` | 'FAILED';
    readonly detail: string | null;
  }
  | { readonly event: 'CHECKPOINT'; readonly label: string; readonly outcome: 'COMMITTED' | 'REFUSED'; readonly detail: string | null };

export interface LiveJuliusProjectBrainBinding {
  readonly brainId: string;
  bootstrap(input: { readonly runId: string }): Promise<{ readonly outcome: 'READY'; readonly created: boolean } | { readonly outcome: 'REFUSED'; readonly problems: readonly string[] }>;
  wrapWriter(inner: JuliusBrainWriter): JuliusBrainWriter;
  wrapContextReader(inner: Pick<JuliusRuntimeReader, 'brainEntriesForRun'>): Pick<JuliusRuntimeReader, 'brainEntriesForRun'>;
  checkpoint(label: string): Promise<'COMMITTED' | 'REFUSED'>;
}

export function createLiveJuliusProjectBrainBinding(deps: {
  readonly store: JuliusBrainStore;
  readonly clock: JuliusClock;
  readonly projectId: string;
  readonly title: string;
  readonly runs: Pick<JuliusRunWriter, 'loadRun'>;
  /** The run's v1 entries as appends (`readJuliusLegacyBrainAppends` on PostgreSQL). */
  readonly legacyEntries: (runId: string, projectId: string) => Promise<readonly JuliusBrainAppend[]>;
  readonly stateModeFor?: (run: JuliusRunRow) => JuliusBrainStateModePolicy;
  readonly contextBudgetCharacters?: number;
  readonly onReport?: (report: JuliusLiveBrainReport) => void;
}): LiveJuliusProjectBrainBinding {
  const brainId = juliusProjectBrainIdFor(deps.projectId);
  const service = createJuliusProjectBrainService({ store: deps.store, clock: deps.clock });
  const julius = juliusPrincipal('JULIUS', 'julius');
  const budget = deps.contextBudgetCharacters ?? JULIUS_LIVE_BRAIN_DEFAULT_CONTEXT_BUDGET;
  const stateModeFor = deps.stateModeFor ?? ((run: JuliusRunRow): JuliusBrainStateModePolicy => ({ mode: 'FRESH', missionId: run.missionId, runId: run.runId }));
  const report = (value: JuliusLiveBrainReport) => deps.onReport?.(value);

  let handle: JuliusBrainHandle | null = null;
  const open = async (): Promise<JuliusBrainHandle | null> => {
    handle ??= await service.open({ brainId, projectId: deps.projectId, principal: julius });
    return handle;
  };

  // One read of the Brain per head, however many roles and tasks ask.
  let cached: { readonly sequence: number; readonly entities: readonly JuliusBrainEntityState[] } | null = null;
  const entitiesNow = async (): Promise<readonly JuliusBrainEntityState[]> => {
    const head = await deps.store.head(brainId, deps.projectId);
    if (head === null) return [];
    if (cached?.sequence !== head.sequence) cached = { sequence: head.sequence, entities: await readAllJuliusBrainEntities(deps.store, brainId, deps.projectId) };
    return cached.entities;
  };

  return {
    brainId,

    async bootstrap({ runId }) {
      const { created } = await service.initialize({ brainId, projectId: deps.projectId, title: deps.title, principal: julius });
      if (!created) {
        const resume = await resumeJuliusBrain(deps.store, brainId, deps.projectId);
        if (resume.status !== 'VERIFIED') {
          report({ event: 'BOOTSTRAP_REFUSED', brainId, runId, problems: resume.problems });
          return { outcome: 'REFUSED', problems: resume.problems };
        }
      }
      const target = (await open())!;
      const run = await deps.runs.loadRun(runId, deps.projectId);
      const entries = (await deps.legacyEntries(runId, deps.projectId)).map(juliusLegacyAppendAsStored);
      const backfill = await backfillJuliusBrainFromLegacy({ handle: target, missionId: run?.missionId ?? null, entries });
      report({ event: 'BOOTSTRAPPED', brainId, runId, created, mirrored: backfill.mirrored, duplicates: backfill.duplicates, refused: backfill.refused.length });
      return { outcome: 'READY', created };
    },

    wrapWriter(inner) {
      const mirror = createJuliusBrainMirroringWriter({
        inner,
        resolve: async (append) => {
          if (append.projectId !== deps.projectId) return null;
          const target = await open();
          if (target === null) return null;
          const run = await deps.runs.loadRun(append.runId, append.projectId);
          return { handle: target, missionId: run?.missionId ?? null };
        },
        onMirror: (value) => report({ event: 'MIRROR', ...value }),
      });
      // The v1 write sees the append as given; the mirror sees it as the table will return it.
      return { appendBrainEntry: async (append) => mirror.appendBrainEntry(juliusLegacyAppendAsStored(append)) };
    },

    wrapContextReader(inner) {
      return {
        async brainEntriesForRun(runId, projectId) {
          const v1 = await inner.brainEntriesForRun(runId, projectId);
          if (projectId !== deps.projectId) return v1;
          const added: JuliusBrainEntry[] = [];
          const pending: JuliusLiveBrainReport[] = [];
          const base = { runId, mode: null, policyHash: null, entries: 0, characters: 0, excluded: {} } as const;
          try {
            const run = await deps.runs.loadRun(runId, projectId);
            if (run === null) {
              for (const role of JULIUS_LIVE_BRAIN_CONTEXT_ROLES) report({ event: 'CONTEXT', ...base, role, withheld: 'RUN_NOT_FOUND', detail: null });
              return v1;
            }
            const policy = stateModeFor(run);
            // v1 already carries this run's own entries; their mirrors would say it twice.
            const entities = (await entitiesNow()).filter((state) => !(state.entityId.startsWith('legacy:') && state.scope.runId === runId));
            for (const role of JULIUS_LIVE_BRAIN_CONTEXT_ROLES) {
              const view = compileJuliusBrainContextForMode(entities, {
                taskId: null, role, grant: defaultJuliusBrainReadGrant(juliusWorkerPrincipal(`julius-live:${role}`, role), brainId),
                budgetCharacters: budget, asOf: deps.clock.now(),
              }, policy);
              if ('outcome' in view) {
                pending.push({ event: 'CONTEXT', ...base, role, withheld: `STATE_MODE_REFUSED:${view.reasonCode}`, detail: view.detail });
                continue;
              }
              const facts = { runId, role, mode: view.mode, policyHash: view.policyHash, excluded: view.excluded } as const;
              if (view.context.authorityTruncated) {
                pending.push({ event: 'CONTEXT', ...facts, entries: 0, characters: 0, withheld: 'AUTHORITY_TRUNCATED', detail: `${view.context.omitted.count} item(s) did not fit ${budget} characters` });
                continue;
              }
              const entries = juliusBrainContextAsEntries(view.context, [role]);
              added.push(...entries);
              pending.push({ event: 'CONTEXT', ...facts, entries: entries.length, characters: view.context.characters, withheld: null, detail: null });
            }
          } catch (error) {
            // Typed context is additive: a failure to build it leaves the run exactly as it was, and says so.
            for (const role of JULIUS_LIVE_BRAIN_CONTEXT_ROLES) report({ event: 'CONTEXT', ...base, role, withheld: 'FAILED', detail: error instanceof Error ? error.message.split('\n')[0]!.slice(0, 300) : 'unknown' });
            return v1;
          }
          for (const value of pending) report(value);
          return [...v1, ...added];
        },
      };
    },

    async checkpoint(label) {
      const target = await open();
      if (target === null) {
        report({ event: 'CHECKPOINT', label, outcome: 'REFUSED', detail: 'brain_not_found' });
        return 'REFUSED';
      }
      const result = await target.checkpoint(label);
      report({ event: 'CHECKPOINT', label, outcome: result.outcome, detail: result.outcome === 'REFUSED' ? `${result.reasonCode}: ${result.detail}` : null });
      return result.outcome;
    },
  };
}
