BEGIN;
-- A CLAIM IS NOT AN EXECUTION.
--
-- `attempt` was incremented by the claim, so a task the scheduler claimed and
-- immediately handed back — because the run's C.A.R.D. concurrency allowance
-- was already spent — spent one of its three attempts without any worker ever
-- being dispatched. It now counts EXECUTION ADMISSIONS only, consumed by
-- `admitTask` immediately before provider-capable work begins.
--
-- That leaves the crash-before-admission loop unbounded: recovery requeued on
-- `attempt`, and a task that is claimed, crashes before admission, and is
-- recovered would never raise the number that stops it. `recoveries` is that
-- bound, incremented by the recovery sweep itself, so the two conditions the
-- one counter used to conflate now have a counter each.
--
-- Existing rows keep whatever `attempt` they hold. The value was a claim count
-- and is now read as an execution count, which can only OVER-state how many
-- executions a task has had — it fails such a task earlier, never later, so
-- the migration cannot make an in-flight task retry more than the old code
-- allowed.
ALTER TABLE relay_wonderland.julius_tasks
 ADD COLUMN recoveries integer NOT NULL DEFAULT 0 CHECK(recoveries>=0);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('022_julius_execution_attempts');
COMMIT;
