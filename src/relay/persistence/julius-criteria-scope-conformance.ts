import type { JuliusAcceptanceCriterion } from '../mission/julius';

/**
 * A CRITERION BELONGS TO A RUN, RUN AGAINST EVERY STORE THAT CLAIMS IT.
 *
 * These cases exist because the two stores DISAGREED and only one of them was
 * ever asked. The in-memory store keys criteria by run (`criteria.set(runId, …)`)
 * and has always been right. PostgreSQL made `criterion_id` the primary key on its
 * own, and the seed insert used a bare `ON CONFLICT DO NOTHING` — so the SECOND run
 * ever to use an id got no criteria at all, silently, across every project and
 * tenant. Every explicit rerun lost all of its criteria, because a rerun reuses the
 * ids by definition, and the run then reported "0 of 0 criteria met".
 *
 * Found by the Wonderland integration lane's fifth in-engine acceptance, against a
 * real database, after every in-memory proof had passed. That is the shape this file
 * exists to stop: written once, run twice, and a store that passes one and fails the
 * other is the drift itself.
 */

export interface JuliusCriteriaScopeStore {
  /** A run in a project, as the bootstrap's ancestry would leave it. */
  createRun(runId: string, projectId: string): Promise<void>;
  /** Seed a run's criteria. Called twice with the same run in one case, on purpose. */
  seed(runId: string, criteria: readonly JuliusAcceptanceCriterion[]): Promise<void>;
  /** The criteria this run holds, scoped by project the way the read path scopes it. */
  read(runId: string, projectId: string): Promise<readonly JuliusAcceptanceCriterion[]>;
}

/** Two ids any two missions could plausibly pick independently, which is the whole problem. */
const CRITERIA: readonly JuliusAcceptanceCriterion[] = Object.freeze([
  Object.freeze({ criterionId: 'criterion-test', description: 'The suite exits zero.', requiredEvidenceTypes: Object.freeze(['TEST' as const]) }),
  Object.freeze({ criterionId: 'created-in-world', description: 'The thing exists.', requiredEvidenceTypes: Object.freeze([]) }),
]);

export interface JuliusCriteriaScopeCase {
  readonly name: string;
  readonly run: (store: JuliusCriteriaScopeStore) => Promise<void>;
}

/**
 * `expect` is passed in rather than imported, so this file stays a contract and the
 * two runners keep their own test framework import.
 */
export function juliusCriteriaScopeCases(
  assert: (actual: unknown, message: string) => { toEqual: (expected: unknown) => void },
): readonly JuliusCriteriaScopeCase[] {
  const ids = (criteria: readonly JuliusAcceptanceCriterion[]): readonly string[] =>
    criteria.map((criterion) => criterion.criterionId);

  return Object.freeze([
    {
      name: 'two runs of ONE project with the same criterion ids each hold their own',
      run: async (store) => {
        await store.createRun('run:scope-a1', 'prj-scope-1');
        await store.createRun('run:scope-a2', 'prj-scope-1');
        await store.seed('run:scope-a1', CRITERIA);
        await store.seed('run:scope-a2', CRITERIA);
        assert(ids(await store.read('run:scope-a1', 'prj-scope-1')),
          'the first run keeps its criteria').toEqual(['criterion-test', 'created-in-world']);
        assert(ids(await store.read('run:scope-a2', 'prj-scope-1')),
          'and the SECOND run is not silently left with none').toEqual(['criterion-test', 'created-in-world']);
      },
    },
    {
      name: 'an EXPLICIT RERUN holds its criteria, which is the case that was always broken',
      run: async (store) => {
        // A rerun runs the same contract, so it reuses every id. Under a global key
        // this was guaranteed to lose all of them.
        await store.createRun('run:scope-first', 'prj-scope-rerun');
        await store.createRun('run:scope-rerun', 'prj-scope-rerun');
        await store.seed('run:scope-first', CRITERIA);
        await store.seed('run:scope-rerun', CRITERIA);
        assert(ids(await store.read('run:scope-rerun', 'prj-scope-rerun')),
          'a rerun that reports 0 of 0 criteria met is reporting a defect as an answer',
        ).toEqual(['criterion-test', 'created-in-world']);
      },
    },
    {
      name: 'two PROJECTS with the same criterion ids do not take each other\'s criteria',
      run: async (store) => {
        await store.createRun('run:scope-p1', 'prj-scope-left');
        await store.createRun('run:scope-p2', 'prj-scope-right');
        await store.seed('run:scope-p1', CRITERIA);
        await store.seed('run:scope-p2', CRITERIA);
        assert(ids(await store.read('run:scope-p1', 'prj-scope-left')), 'the left project keeps its own')
          .toEqual(['criterion-test', 'created-in-world']);
        assert(ids(await store.read('run:scope-p2', 'prj-scope-right')),
          'a global key made this an ISOLATION defect, not only a uniqueness one')
          .toEqual(['criterion-test', 'created-in-world']);
      },
    },
    {
      name: 'seeding the SAME run twice is idempotent, which is what the conflict clause was for',
      run: async (store) => {
        await store.createRun('run:scope-idem', 'prj-scope-idem');
        await store.seed('run:scope-idem', CRITERIA);
        await store.seed('run:scope-idem', CRITERIA);
        assert(ids(await store.read('run:scope-idem', 'prj-scope-idem')),
          'a replayed seed must neither duplicate nor lose a criterion')
          .toEqual(['criterion-test', 'created-in-world']);
      },
    },
    {
      name: 'a run read from the WRONG project holds nothing',
      run: async (store) => {
        await store.createRun('run:scope-x', 'prj-scope-owner');
        await store.seed('run:scope-x', CRITERIA);
        assert(ids(await store.read('run:scope-x', 'prj-scope-stranger')),
          'the read is scoped by project, and a stranger sees nothing').toEqual([]);
      },
    },
  ]);
}
