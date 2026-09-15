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
 * THE BRAIN RUN IS NAMED BY THE COMPOSITION ROOT, NEVER DEFAULTED. The Julius
 * run id is derived from the mission contract and repeats across paid attempts;
 * `brainRunIdFor` supplies the identity the Brain scopes and namespaces the run
 * by — for a paid run, `workflow:<GITHUB_RUN_ID>/<GITHUB_RUN_ATTEMPT>`, the same
 * identity the paid-run archive importer uses — so attempt 2 is never attempt 1.
 *
 * THE DEFAULT STATE MODE IS FRESH. v1 context is already run-scoped (the port
 * reads one run's entries), so FRESH is today's semantics: a run is shaped by
 * its own state and its mission's authority, never by an earlier run. Anything
 * wider is declared per run by `stateModeFor`.
 *
 * WHEN THE BRAIN DATABASE IS UNAVAILABLE, OR DOES NOT VERIFY, the answer
 * depends on what the run needs it for. A FRESH run is not shaped by prior state,
 * so the Brain is ADDITIVE: the run may proceed on its v1 context. A
 * CONTINUATION, LEARNING or REGRESSION run exists to use prior state, so the
 * Brain is REQUIRED and the run must not start. Either way the binding DETACHES
 * for the rest of the run — no mirror into a Brain it could not verify or reach,
 * no typed context — and `preservation()` says the run is NOT preserved. The
 * paid-run archive import is how such a run reaches the Brain later.
 *
 * PRESERVED IS A FACT, NOT AN INTENTION: only a verified bootstrap, every
 * mirror written, and a committed checkpoint make `preserved: true`.
 *
 * TYPED CONTEXT IS ALL OR NOTHING PER ROLE. If the budget would cut the
 * mission's authority, the role gets none of the v2 entries and the refusal
 * is reported; a partial set of requirements is worse than the v1 context
 * alone.
 */

export const JULIUS_LIVE_BRAIN_CONTEXT_ROLES: readonly JuliusWorkerRole[] = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];
export const JULIUS_LIVE_BRAIN_DEFAULT_CONTEXT_BUDGET = 4_000;

export type JuliusBrainRequirement = 'ADDITIVE' | 'REQUIRED';

/** FRESH is not shaped by prior state; every other mode exists to use it. */
export const juliusBrainRequirementFor = (policy: JuliusBrainStateModePolicy): JuliusBrainRequirement => (policy.mode === 'FRESH' ? 'ADDITIVE' : 'REQUIRED');

export type JuliusLiveBrainBootstrap =
  | { readonly outcome: 'READY'; readonly created: boolean; readonly requirement: JuliusBrainRequirement; readonly proceed: true }
  | { readonly outcome: 'REFUSED'; readonly problems: readonly string[]; readonly requirement: JuliusBrainRequirement; readonly proceed: boolean }
  | { readonly outcome: 'UNAVAILABLE'; readonly detail: string; readonly requirement: JuliusBrainRequirement; readonly proceed: boolean };

export interface JuliusLiveBrainPreservation {
  readonly bootstrap: 'NOT_RUN' | JuliusLiveBrainBootstrap['outcome'];
  readonly mirrorsWritten: number;
  readonly mirrorsNotWritten: number;
  readonly checkpoint: 'NOT_RUN' | 'COMMITTED' | 'REFUSED' | 'UNAVAILABLE' | 'NOT_ATTEMPTED';
  readonly preserved: boolean;
  readonly reasons: readonly string[];
}

export function juliusProjectBrainIdFor(projectId: string): string {
  const brainId = `brain:${projectId}`;
  if (!isJuliusBrainId(brainId)) throw new Error('julius_project_brain_id_invalid');
  return brainId;
}

export type JuliusLiveBrainReport =
  | { readonly event: 'BOOTSTRAPPED'; readonly brainId: string; readonly runId: string; readonly created: boolean; readonly mirrored: number; readonly duplicates: number; readonly refused: number }
  | { readonly event: 'BOOTSTRAP_REFUSED'; readonly brainId: string; readonly runId: string; readonly problems: readonly string[]; readonly requirement: JuliusBrainRequirement }
  | { readonly event: 'BRAIN_UNAVAILABLE'; readonly brainId: string; readonly runId: string; readonly detail: string; readonly requirement: JuliusBrainRequirement }
  | ({ readonly event: 'MIRROR' } & JuliusBrainMirrorReport)
  | {
    readonly event: 'CONTEXT'; readonly runId: string; readonly role: JuliusWorkerRole; readonly mode: string | null; readonly policyHash: string | null;
    readonly entries: number; readonly characters: number; readonly excluded: Readonly<Record<string, number>>;
    /** Why no typed context was added for this role, or null when it was. */
    readonly withheld: null | 'AUTHORITY_TRUNCATED' | 'RUN_NOT_FOUND' | `STATE_MODE_REFUSED:${string}` | 'FAILED' | 'BRAIN_DETACHED';
    readonly detail: string | null;
  }
  | { readonly event: 'CHECKPOINT'; readonly label: string; readonly outcome: 'COMMITTED' | 'REFUSED' | 'UNAVAILABLE' | 'NOT_ATTEMPTED'; readonly detail: string | null };

export interface LiveJuliusProjectBrainBinding {
  readonly brainId: string;
  /** Loads the run from the runtime store (which must be reachable), then the Brain; a Brain failure is an answer, not a throw. */
  bootstrap(input: { readonly runId: string }): Promise<JuliusLiveBrainBootstrap>;
  wrapWriter(inner: JuliusBrainWriter): JuliusBrainWriter;
  wrapContextReader(inner: Pick<JuliusRuntimeReader, 'brainEntriesForRun'>): Pick<JuliusRuntimeReader, 'brainEntriesForRun'>;
  checkpoint(label: string): Promise<JuliusLiveBrainPreservation['checkpoint']>;
  preservation(): JuliusLiveBrainPreservation;
}

export function createLiveJuliusProjectBrainBinding(deps: {
  readonly store: JuliusBrainStore;
  readonly clock: JuliusClock;
  readonly projectId: string;
  readonly title: string;
  readonly runs: Pick<JuliusRunWriter, 'loadRun'>;
  /** The run's v1 entries as appends (`readJuliusLegacyBrainAppends` on PostgreSQL). */
  readonly legacyEntries: (runId: string, projectId: string) => Promise<readonly JuliusBrainAppend[]>;
  /** The Brain run this Julius run is: for a paid run, its workflow run and attempt. Required — there is no safe default. */
  readonly brainRunIdFor: (run: JuliusRunRow) => string;
  readonly stateModeFor?: (run: JuliusRunRow, brainRunId: string) => JuliusBrainStateModePolicy;
  readonly contextBudgetCharacters?: number;
  readonly onReport?: (report: JuliusLiveBrainReport) => void;
}): LiveJuliusProjectBrainBinding {
  const brainId = juliusProjectBrainIdFor(deps.projectId);
  const service = createJuliusProjectBrainService({ store: deps.store, clock: deps.clock });
  const julius = juliusPrincipal('JULIUS', 'julius');
  const budget = deps.contextBudgetCharacters ?? JULIUS_LIVE_BRAIN_DEFAULT_CONTEXT_BUDGET;
  const stateModeFor = deps.stateModeFor ?? ((run: JuliusRunRow, brainRunId: string): JuliusBrainStateModePolicy => ({ mode: 'FRESH', missionId: run.missionId, runId: brainRunId }));
  const brainRunOf = (run: JuliusRunRow): string => {
    const id = deps.brainRunIdFor(run);
    if (!isJuliusBrainId(id)) throw new Error('julius_live_brain_run_id_invalid');
    return id;
  };
  const firstLine = (error: unknown) => (error instanceof Error ? error.message.split('\n')[0]!.slice(0, 300) : 'unknown');
  const state = {
    bootstrap: 'NOT_RUN' as JuliusLiveBrainPreservation['bootstrap'],
    detached: false,
    mirrorsWritten: 0,
    mirrorsNotWritten: 0,
    checkpoint: 'NOT_RUN' as JuliusLiveBrainPreservation['checkpoint'],
  };
  const report = (value: JuliusLiveBrainReport) => {
    if (value.event === 'MIRROR') {
      if (value.outcome === 'MIRRORED' || value.outcome === 'DUPLICATE') state.mirrorsWritten += 1;
      else state.mirrorsNotWritten += 1;
    }
    deps.onReport?.(value);
  };

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
      // The runtime store is the run's own authority; if it is unreachable there is no run to bootstrap.
      const run = await deps.runs.loadRun(runId, deps.projectId);
      if (run === null) throw new Error('julius_live_brain_run_not_found');
      const brainRunId = brainRunOf(run);
      const requirement = juliusBrainRequirementFor(stateModeFor(run, brainRunId));
      const proceed = requirement === 'ADDITIVE';
      try {
        const { created } = await service.initialize({ brainId, projectId: deps.projectId, title: deps.title, principal: julius });
        if (!created) {
          const resume = await resumeJuliusBrain(deps.store, brainId, deps.projectId);
          if (resume.status !== 'VERIFIED') {
            state.bootstrap = 'REFUSED';
            state.detached = true;
            report({ event: 'BOOTSTRAP_REFUSED', brainId, runId, problems: resume.problems, requirement });
            return { outcome: 'REFUSED', problems: resume.problems, requirement, proceed };
          }
        }
        const target = (await open())!;
        const entries = (await deps.legacyEntries(runId, deps.projectId)).map(juliusLegacyAppendAsStored);
        const backfill = await backfillJuliusBrainFromLegacy({ handle: target, missionId: run.missionId, brainRunId, entries });
        state.mirrorsNotWritten += backfill.refused.length;
        state.bootstrap = 'READY';
        report({ event: 'BOOTSTRAPPED', brainId, runId, created, mirrored: backfill.mirrored, duplicates: backfill.duplicates, refused: backfill.refused.length });
        return { outcome: 'READY', created, requirement, proceed: true };
      } catch (error) {
        state.bootstrap = 'UNAVAILABLE';
        state.detached = true;
        report({ event: 'BRAIN_UNAVAILABLE', brainId, runId, detail: firstLine(error), requirement });
        return { outcome: 'UNAVAILABLE', detail: firstLine(error), requirement, proceed };
      }
    },

    wrapWriter(inner) {
      const mirror = createJuliusBrainMirroringWriter({
        inner,
        resolve: async (append) => {
          if (append.projectId !== deps.projectId || state.detached) return null;
          const target = await open();
          if (target === null) return null;
          const run = await deps.runs.loadRun(append.runId, append.projectId);
          if (run === null) return null;
          return { handle: target, missionId: run.missionId, brainRunId: brainRunOf(run) };
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
          if (state.detached) {
            for (const role of JULIUS_LIVE_BRAIN_CONTEXT_ROLES) report({ event: 'CONTEXT', ...base, role, withheld: 'BRAIN_DETACHED', detail: null });
            return v1;
          }
          try {
            const run = await deps.runs.loadRun(runId, projectId);
            if (run === null) {
              for (const role of JULIUS_LIVE_BRAIN_CONTEXT_ROLES) report({ event: 'CONTEXT', ...base, role, withheld: 'RUN_NOT_FOUND', detail: null });
              return v1;
            }
            const brainRunId = brainRunOf(run);
            const policy = stateModeFor(run, brainRunId);
            // v1 already carries this run's own entries; their mirrors would say it twice.
            const entities = (await entitiesNow()).filter((state) => !(state.entityId.startsWith('legacy:') && state.scope.runId === brainRunId));
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
            for (const role of JULIUS_LIVE_BRAIN_CONTEXT_ROLES) report({ event: 'CONTEXT', ...base, role, withheld: 'FAILED', detail: firstLine(error) });
            return v1;
          }
          for (const value of pending) report(value);
          return [...v1, ...added];
        },
      };
    },

    async checkpoint(label) {
      if (state.detached) {
        state.checkpoint = 'NOT_ATTEMPTED';
        report({ event: 'CHECKPOINT', label, outcome: 'NOT_ATTEMPTED', detail: 'brain_detached' });
        return 'NOT_ATTEMPTED';
      }
      try {
        const target = await open();
        if (target === null) {
          state.checkpoint = 'REFUSED';
          report({ event: 'CHECKPOINT', label, outcome: 'REFUSED', detail: 'brain_not_found' });
          return 'REFUSED';
        }
        const result = await target.checkpoint(label);
        state.checkpoint = result.outcome;
        report({ event: 'CHECKPOINT', label, outcome: result.outcome, detail: result.outcome === 'REFUSED' ? `${result.reasonCode}: ${result.detail}` : null });
        return result.outcome;
      } catch (error) {
        state.checkpoint = 'UNAVAILABLE';
        report({ event: 'CHECKPOINT', label, outcome: 'UNAVAILABLE', detail: firstLine(error) });
        return 'UNAVAILABLE';
      }
    },

    preservation() {
      const reasons: string[] = [];
      if (state.bootstrap !== 'READY') reasons.push(`bootstrap ${state.bootstrap}`);
      if (state.mirrorsNotWritten > 0) reasons.push(`${state.mirrorsNotWritten} v1 entr${state.mirrorsNotWritten === 1 ? 'y was' : 'ies were'} not written to the Brain`);
      if (state.checkpoint !== 'COMMITTED') reasons.push(`checkpoint ${state.checkpoint}`);
      return {
        bootstrap: state.bootstrap, mirrorsWritten: state.mirrorsWritten, mirrorsNotWritten: state.mirrorsNotWritten,
        checkpoint: state.checkpoint, preserved: reasons.length === 0, reasons,
      };
    },
  };
}
