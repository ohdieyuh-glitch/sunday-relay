-- A REPRESENTATIVE STORE AT 030, for the window rehearsal only. Never run against a live store.
-- Shapes the live store holds (runs in several states with their tasks, events with their outbox rows written in the
-- same transaction as 030's registry requires, brain entries and claim standings), in volumes large enough for the
-- row-count and catalog comparisons to mean something. Deterministic: the same seed every time.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO relay_wonderland.projects(project_id) SELECT 'prj-window-' || g FROM generate_series(1, 3) g;
INSERT INTO relay_wonderland.mission_contracts(mission_id, project_id, stage, canonical_hash, snapshot)
  SELECT 'mission:window-' || g, 'prj-window-' || (1 + g % 3), 'READY', 'hash-window-' || g, '{}'::jsonb FROM generate_series(1, 12) g;
INSERT INTO relay_wonderland.julius_runs(run_id, mission_id, project_id, state, runtime_version, card_revision, mission_contract_revision, project_brain_revision)
  SELECT 'run:window-' || g, 'mission:window-' || g, 'prj-window-' || (1 + g % 3),
         (ARRAY['COMPLETED','FAILED','EXECUTING','REVIEWING','CANCELLED','PAUSED'])[1 + g % 6], '1', 'card', 1, 0
    FROM generate_series(1, 12) g;
INSERT INTO relay_wonderland.julius_tasks(task_id, run_id, parent_task_id, role, task_type, state, ordinal, required_evidence_types)
  SELECT 'run:window-' || r || ':' || t.kind, 'run:window-' || r, NULL, t.role, t.kind, 'SUCCEEDED', t.ord, '[]'::jsonb
    FROM generate_series(1, 12) r
   CROSS JOIN (VALUES ('plan', 'PROMPT_ARCHITECT', 0), ('build', 'CODING_AGENT', 1), ('review', 'INDEPENDENT_REVIEWER', 2)) AS t(kind, role, ord);
INSERT INTO relay_wonderland.julius_brain_entries(entry_id, run_id, project_id, task_id, worker_id, entry_kind, safe_content, evidence_ids, revision, created_at)
  SELECT 'entry:window-' || r || ':' || k, 'run:window-' || r, 'prj-window-' || (1 + r % 3), NULL, 'relay-bootstrap', 'CONSTRAINT',
         'OBJECTIVE: rehearse the window ' || r || '/' || k, '[]'::jsonb, k, now()
    FROM generate_series(1, 12) r CROSS JOIN generate_series(1, 4) k;
COMMIT;
-- Events and their outbox rows, ONE transaction per run, as the writers write them (030: an outbox row must name an
-- event written in its own transaction).
DO $$
BEGIN
  FOR r IN 1..12 LOOP
    INSERT INTO relay_wonderland.events(event_id, stream_id, project_id, sequence, event_type, visibility, payload, occurred_at)
      SELECT 'event:window-' || r || ':' || s, 'run:window-' || r, 'prj-window-' || (1 + r % 3), s,
             'julius.' || (ARRAY['run.created','task.claimed','worker.dispatched','worker.completed','verification.decided'])[1 + s % 5],
             'PROJECT', jsonb_build_object('facts', jsonb_build_object('seq', s)), now()
        FROM generate_series(1, 25) s;
    INSERT INTO relay_wonderland.outbox(outbox_id, event_id, project_id)
      SELECT 'outbox:event:window-' || r || ':' || s, 'event:window-' || r || ':' || s, 'prj-window-' || (1 + r % 3)
        FROM generate_series(1, 25) s;
  END LOOP;
END
$$;
