-- THE CARRY EXPORT, julius-carry-export.v1 (Decision C on the paid venue).
--
-- ONE RUN'S REVIEWER FINDINGS AND THE LEDGER ROWS THAT GIVE THEM THEIR LIVES, as one JSON document, so a paired WITH
-- arm can learn from this run after this job's database is gone. Run by .github/julius-live-evidence-dump.sh with the
-- psql variable `run` set to the manifest's julius_run_id; the document is written to carry-export.json and its sha256
-- appended to bundle-manifest.txt. The WITH arm's job verifies both (src/relay/mission/julius/julius-carry-archive.ts).
--
-- WHAT IS IN IT, AND WHY IT IS THE STORE PATH'S OWN SHAPE.
--   findings  every column of julius_reviewer_findings that JuliusReviewerFinding has, in the order and with the
--             precision the store reader gives (JuliusReadPostgresRepository.findingsForRun reads created_at through
--             a JS Date's string form, which keeps whole seconds; the export truncates to the second to match), so
--             the carry selected from this file is the carry the store path would have selected. The claim is the
--             same reviewer text findings.tsv already carries; JSON, not TSV, because a claim may hold a tab or a
--             line break.
--   ledger    the run's finding.recorded and finding.transitioned events in ledger order (the sequence the event
--             store allocated), each with its task and NAMED fact keys only: the identifiers the lifecycle fold
--             reads (finding, review, repair, replacement, move, target state, instant) and the recorded finding's
--             own tokens. Never a payload whole.
--
-- A RUN THE MANIFEST DOES NOT NAME EXPORTS NO RUN: the document is still written, with runId null and empty lists,
-- and the verifier refuses it, so "nothing to learn" and "nobody could say which run" never share a file.
SELECT json_build_object(
  'format', 'julius-carry-export.v1',
  'runId', r.run_id,
  'projectId', r.project_id,
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
        'at', e.payload->'facts'->'at',
        'evidenceId', e.payload->'facts'->'evidenceId',
        'blocking', e.payload->'facts'->'blocking',
        'category', e.payload->'facts'->'category'
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
