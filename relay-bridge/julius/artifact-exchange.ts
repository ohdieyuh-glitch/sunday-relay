import type { JuliusDurableArtifacts } from './durable-artifacts';
import { juliusWorkArtifactRef, type JuliusWorkArtifactKind } from '../../src/relay/mission/julius';

/**
 * WHERE A LIVE MISSION READS AND WRITES ITS BODIES.
 *
 * #285 built the durable home and deliberately wired nothing to it: the live
 * exchange was still a `Map<string,string>` in one process, keyed per RUN
 * (`plan:<runId>`, `diff:<runId>`). This is the wiring, and it changes the
 * SHAPE of the question a reader may ask, not just where the answer comes
 * from.
 *
 * READS ARE ATTEMPT-EXACT. THERE IS NO "LATEST" ON THIS PORT.
 *
 * That is the whole design, and it is worth saying why, because "give me the
 * newest diff for this run" is the obvious API and it is wrong:
 *
 *   attempt 1   captures DIFF A, is reviewed, is sent back for repair
 *   attempt 2   runs, and its `git diff` capture FAILS
 *
 * A reader asking for "the latest DIFF in this run" — or in this TASK, which
 * has the same hole — is handed DIFF A. The reviewer then judges attempt 1's
 * code while believing it judged attempt 2's, and records an approval that
 * names the wrong bytes. Nothing about that is visible: both artifacts are
 * real, both digests verify, and the answer is simply about the wrong round.
 *
 * The per-run map avoided this with `clear()`: a coder dispatch erased the
 * run's diff and test output before it ran, so a failed capture left NOTHING
 * rather than the previous round's body beside this round's test. An
 * append-only store cannot erase, so the guarantee has to be re-earned on the
 * read side instead — and attempt-exact reads earn it more strongly than
 * `clear` did. A body that was never written for THIS attempt resolves to
 * null, the adapters' existing `reviewer_implementation_absent` refusal fires
 * exactly as it does today, and the mission fails visibly rather than
 * completing on a stale truth. `clear()` is therefore gone, not ported: with
 * an attempt-exact read there is nothing it could still protect against.
 *
 * `JuliusDurableArtifacts.latest()` still exists and is still correct for what
 * #285 built it for — a reader that genuinely wants "the current one" and is
 * not judging it. Nothing on the live path uses it, and this port does not
 * expose it, so no later edit can reach for it by accident.
 *
 * THE EXCHANGE IS BOUND TO ONE PROJECT, which is the tenancy boundary and a
 * composition fact no adapter may vary. Everything narrower — run, task,
 * attempt — comes from the dispatch and the context Julius compiled for it,
 * never from a worker's output.
 */

/** Identity of a body: which attempt of which task of which run produced which kind. */
export interface JuliusArtifactAttempt {
  readonly kind: JuliusWorkArtifactKind;
  /**
   * The run, from the COMPILED CONTEXT the adapter was dispatched with —
   * Julius compiled and persisted it, and every adapter already reads its
   * `runId` from there. It is not bound at construction because the workers
   * are resolved before the run row exists.
   */
  readonly runId: string;
  readonly taskId: string;
  /** The fencing token of the attempt. Never the run, never `attempt`. */
  readonly leaseGeneration: number;
}

/** A write additionally says who produced it, so a reader can tell a packet from a diff. */
export interface JuliusArtifactWrite extends JuliusArtifactAttempt {
  readonly role: string;
}

export interface JuliusArtifactExchange {
  /**
   * Keep a body for exactly this attempt, and answer with the DURABLE
   * REFERENCE to it.
   *
   * Returning the reference is what lets an evidence row point at the body it
   * is a claim about. Every such row on this path carried `artifactRef: null`,
   * and the comments said why: the only name a body had was a key into a map
   * that died with the process, and `plan:<runId>` would have told a later
   * reader "look here" for something they would never find. Null was the
   * honest answer then. It is not the honest answer now.
   */
  put(attempt: JuliusArtifactWrite, text: string): Promise<string>;
  /**
   * The body THIS EXACT ATTEMPT produced, or null.
   *
   * Null is the honest answer for "this attempt produced none", and every
   * caller already treats absence as a refusal rather than a default.
   */
  get(attempt: JuliusArtifactAttempt): Promise<string | null>;
}

/**
 * The cap the per-run map enforced, kept verbatim.
 *
 * It bounded process memory there; here it bounds what one runaway worker can
 * commit to durable storage and hand to the next worker's context window. The
 * second reason outlives the first, so the cap stays even though the `Map` it
 * was written for is gone.
 */
export const ARTIFACT_TEXT_CAP = 256 * 1024;

/**
 * The live exchange, backed by the durable store #285 landed.
 *
 * `now` is injectable because `occurredAt` is part of the record and a proof
 * that cannot fix the clock cannot assert on the row it wrote.
 */
export function createDurableArtifactExchange(input: {
  readonly artifacts: JuliusDurableArtifacts;
  readonly projectId: string;
  readonly now?: () => string;
}): JuliusArtifactExchange {
  const now = input.now ?? (() => new Date().toISOString());
  const scopeOf = (attempt: JuliusArtifactAttempt) => ({
    projectId: input.projectId,
    runId: attempt.runId,
    taskId: attempt.taskId,
    leaseGeneration: attempt.leaseGeneration,
    kind: attempt.kind,
  });

  return {
    async put(attempt, text) {
      const written = await input.artifacts.put(
        { ...scopeOf(attempt), role: attempt.role, occurredAt: now() },
        text.slice(0, ARTIFACT_TEXT_CAP),
      );
      return written.ref;
    },
    async get(attempt) {
      return input.artifacts.get(scopeOf(attempt));
    },
  };
}

/**
 * AN EXCHANGE WITH NO DURABILITY, for proofs about ADAPTER behaviour.
 *
 * The durability proofs use the REAL content store on a real directory, as
 * `durable-artifacts.test.ts` does; a test about what an adapter writes or
 * refuses does not need a filesystem, and paying for one per case would make
 * the suite slow enough to be run less.
 *
 * It is keyed by the SAME identity the durable exchange uses — run, task,
 * attempt, kind — so a proof cannot pass here by reading an attempt the
 * durable store would have answered with null. That is the whole point of
 * offering it rather than letting each test invent a stub: a hand-rolled fake
 * keyed by kind alone would quietly restore the per-run map this change
 * removed, and every attempt-exactness proof would pass against it.
 */
export interface InMemoryArtifactExchange extends JuliusArtifactExchange {
  /**
   * Put a body without awaiting — harness setup only.
   *
   * `put` is async because the durable exchange is, and a harness that builds
   * an adapter synchronously should not have to become async just to seed the
   * plan its subject reads. It writes through the SAME key, so a seeded body
   * is as attempt-exact as a written one.
   */
  seed(attempt: JuliusArtifactWrite, text: string): void;
}

export function createInMemoryArtifactExchange(): InMemoryArtifactExchange {
  const bodies = new Map<string, string>();
  const key = (attempt: JuliusArtifactAttempt): string =>
    [attempt.runId, attempt.taskId, String(attempt.leaseGeneration), attempt.kind].join('\u0000');
  const write = (attempt: JuliusArtifactAttempt, text: string): void => {
    bodies.set(key(attempt), text.slice(0, ARTIFACT_TEXT_CAP));
  };
  return {
    seed: write,
    async put(attempt, text) { write(attempt, text); return juliusWorkArtifactRef({ projectId: 'prj-memory', ...attempt }); },
    async get(attempt) { return bodies.get(key(attempt)) ?? null; },
  };
}
