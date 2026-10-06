-- THE CARRY'S SOURCES, julius-carry-sources.v1 (Decision C, C-7: the four-point chain, provable OFF-HOST).
--
-- ONE RUN'S REVIEWER FINDINGS, THE LEDGER ROWS THAT GIVE THEM THEIR LIVES, AND THE RUN AND TASK FACTS A CARRIED
-- FINDING'S HEADER RENDERS, as one JSON document. Run by .github/julius-live-evidence-dump.sh with the psql variable
-- `run` set to the manifest's julius_run_id; written to carry-sources.json, its sha256 appended to
-- bundle-manifest.txt. The off-host verifier (src/relay/mission/julius/julius-carry-verify.ts) re-derives from THIS
-- file alone every row a later run of the same mission carried from this one: the same rule
-- (planJuliusKnowledgeCarry), the same lifecycle fold (foldJuliusFindings), the same renderer, and the full sha256 of
-- each text, held against the later run's knowledge.carried record and its copy rows.
--
-- WHAT IS IN IT, AND WHY IT IS THE STORE READER'S OWN SHAPE.
--   run       its id, project, mission and state (julius_runs): the header's SOURCE RUN line.
--   tasks     every task of the run with its type and role (julius_tasks): the header's SOURCE TASK line.
--   findings  every column JuliusReviewerFinding has, as JuliusReadPostgresRepository.findingsForRun reads it:
--             created_at to the whole second (the reader goes through a JS Date's string form), in the reader's
--             order. The claim is the reviewer text findings.tsv already carries; JSON, not TSV, because a claim
--             may hold a tab or a line break.
--   ledger    the run's finding.recorded and finding.transitioned events in ledger order, each with its task and
--             NAMED fact keys only: the identifiers the lifecycle fold reads. Never a payload whole.
--
-- A RUN THE MANIFEST DOES NOT NAME EXPORTS NO RUN: the document still says so (runId null, empty lists), and the
-- verifier refuses it, so "nothing to carry" and "nobody could say which run" never share a file.
SELECT json_build_object(
  'format', 'julius-carry-sources.v1',
  'runId', r.run_id,
  'projectId', r.project_id,
  'missionId', r.mission_id,
  'state', r.state,
  'tasks', COALESCE((
    SELECT json_agg(json_build_object('taskId', t.task_id, 'taskType', t.task_type, 'role', t.role) ORDER BY t.ordinal, t.task_id)
    FROM relay_wonderland.julius_tasks t
    WHERE t.run_id = r.run_id
  ), '[]'::json),
  'findings', COALESCE((
    SELECT json_agg(json_build_object(
      'findingId', f.finding_id,
      'runId', f.run_id,
      'taskId', f.task_id,
      'reviewerWorkerId', f.reviewer_worker_id,
      'severity', f.severity,
      'category', f.category,
      'claim', f.claim,
      'criterionId', f.criterion_id,
      'evidenceIds', f.evidence_ids,
      'blocking', f.blocking,
      'status', f.status,
      'createdAt', to_char(date_trunc('second', f.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY f.created_at, f.finding_id)
    FROM relay_wonderland.julius_reviewer_findings f
    WHERE f.run_id = r.run_id
  ), '[]'::json),
  'ledger', COALESCE((
    SELECT json_agg(json_build_object(
      'sequence', e.sequence,
      'type', substr(e.event_type, 8),
      'taskId', e.payload->>'taskId',
      'facts', json_strip_nulls(json_build_object(
        'findingId', e.payload->'facts'->'findingId',
        'reviewTaskId', e.payload->'facts'->'reviewTaskId',
        'repairTaskId', e.payload->'facts'->'repairTaskId',
        'supersededByFindingId', e.payload->'facts'->'supersededByFindingId',
        'move', e.payload->'facts'->'move',
        'to', e.payload->'facts'->'to',
        'at', e.payload->'facts'->'at'
      ))
    ) ORDER BY e.sequence)
    FROM relay_wonderland.events e
    WHERE e.stream_id = r.run_id
      AND e.project_id = r.project_id
      AND e.event_type IN ('julius.finding.recorded', 'julius.finding.transitioned')
  ), '[]'::json)
)
FROM (SELECT :'run'::text AS wanted) w
LEFT JOIN relay_wonderland.julius_runs r ON r.run_id = w.wanted;
