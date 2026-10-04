#!/usr/bin/env bash
# THE MIGRATION WINDOW, AS ONE PROCEDURE: 031 then 032 (then 033 when asked), exactly as their runbooks say, recorded.
#
# Each migration's RUNBOOK.md is the authority; this wrapper only runs its steps in order and refuses to continue past
# any condition the runbook says to STOP on. For every migration M in the window:
#   precheck  docs/julius-migrations/M/precheck.sql      -> its PASS conditions, read back from its own output
#   apply     the landed migration file, ON_ERROR_STOP    -> exit 0 required; its NOTICE lines kept
#   postcheck docs/julius-migrations/M/postcheck.sql     -> its PASS conditions, plus the comparisons with the precheck
#   ledger    the ledger's last stamp must be M's, and its count one more than before
#   rows      R1 row counts (030/rowcounts-store.sql) unchanged by M, table for table (033 may only ADD empty tables)
#   catalog   R1 fingerprint (030/fingerprint-store.sql) recorded after M, for Second's comparison with a reference
# Before the first migration: no other client session may be connected (the writers are stopped), and a verified
# backup is taken (pg_dump -Fc, its TOC checked, restored into a scratch database and its row counts compared).
#
# THE SAME SCRIPT RUNS THE REHEARSAL AND THE REAL WINDOW. What was rehearsed is what runs.
# The live store (container julius-postgres) is refused unless --live is given with the exact phrase
#   "APPLY THE WINDOW TO THE LIVE STORE"
# and DATABASE_URL is never read, set or restored here (founder ruling R-6).
#
# Usage:
#   window.sh --container NAME --through 032 --record DIR [--repo PATH] [--db julius] [--user julius] [--live PHRASE]
# Exit: 0 PASS; 2 a STOP condition (the record says which); 1 usage or environment.
set -euo pipefail

CONTAINER=""; THROUGH=""; RECORD=""; REPO="$(cd "$(dirname "$0")/../../.." && pwd)"; DB="julius"; DBUSER="julius"; LIVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --through) THROUGH="$2"; shift 2 ;;
    --record) RECORD="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --user) DBUSER="$2"; shift 2 ;;
    --live) LIVE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
[ -n "$CONTAINER" ] && [ -n "$THROUGH" ] && [ -n "$RECORD" ] || { echo "usage: window.sh --container NAME --through 032|033 --record DIR" >&2; exit 1; }
case "$THROUGH" in 032) WINDOW=(031 032) ;; 033) WINDOW=(031 032 033) ;; *) echo "--through must be 032 or 033" >&2; exit 1 ;; esac
if [ "$CONTAINER" = "julius-postgres" ] && [ "$LIVE" != "APPLY THE WINDOW TO THE LIVE STORE" ]; then
  echo "REFUSED: julius-postgres is the live store; pass --live \"APPLY THE WINDOW TO THE LIVE STORE\" on a recorded decision" >&2; exit 1
fi

declare -A STAMP=(
  [030]=030_julius_outbox_event_no_reread
  [031]=031_julius_run_transition_hot
  [032]=032_julius_outbox_event_delete_forgets
  [033]=033_wonderland_social
)
declare -A FILE=(
  [031]=src/relay/persistence/wonderland-migrations/031_julius_run_transition_hot.sql
  [032]=src/relay/persistence/wonderland-migrations/032_julius_outbox_event_delete_forgets.sql
  [033]=src/relay/persistence/wonderland-migrations/033_wonderland_social.sql
)
# PASS conditions, transcribed from each RUNBOOK.md (step 2: precheck; step 4: postcheck). key=value, value may be empty.
declare -A PRE=(
  [031]="old_index_matches=t new_name_free=t migration_030_applied=t migration_031_applied=f"
  [032]="delete_trigger_matches=t registry_triggers_match=t function_is_030=t function_has_forget=f remember_is_030=t remember_has_filter=f orphan_outbox_rows=0 migration_030_applied=t migration_031_applied=t migration_032_applied=f ledger_last=031_julius_run_transition_hot"
  [033]="migration_032_applied=t migration_033_applied=f social_tables_present=0 ledger_last=032_julius_outbox_event_delete_forgets"
)
declare -A POST=(
  [031]="old_index_present=f new_index_matches=t update_columns_indexed= migration_031_applied=t"
  [032]="delete_trigger_matches=t registry_triggers_match=t function_is_030=f function_has_forget=t remember_is_030=f remember_has_filter=t orphan_outbox_rows=0 migration_032_applied=t ledger_last=032_julius_outbox_event_delete_forgets"
  [033]="migration_033_applied=t ledger_last=033_wonderland_social social_tables_present=15 social_rows=0 recent_players_columns=0"
)
# Values the postcheck must repeat from the precheck (RUNBOOK step 4: "equals step 2's").
declare -A SAME=( [031]="runs_rows" [032]="events_rows outbox_rows" [033]="players_rows" )

mkdir -p "$RECORD"
SUMMARY="$RECORD/SUMMARY.txt"
: > "$SUMMARY"
say() { echo "$*" | tee -a "$SUMMARY"; }
stop() { say "STOP: $*"; say "RESULT: STOP"; exit 2; }
utc() { date -u +%Y%m%dT%H%M%SZ; }
# psql in the container; expanded unaligned output, so every column reads back as "name|value".
sql_file() { docker exec -i "$CONTAINER" psql -X -q -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 -A -x -F '|' < "$1"; }
sql_raw() { docker exec -i "$CONTAINER" psql -X -q -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 < "$1"; }
sql_value() { docker exec -i "$CONTAINER" psql -X -q -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 -A -t -c "$1"; }
value_of() { grep -E "^$1\|" "$2" | head -1 | cut -d'|' -f2- || true; }
check_all() { # check_all "<k=v ...>" file label
  local ok=1 pair key want got
  for pair in $1; do
    key="${pair%%=*}"; want="${pair#*=}"; got="$(value_of "$key" "$2")"
    if grep -qE "^$key\|" "$2"; then :; else say "  $3: $key MISSING from output"; ok=0; continue; fi
    if [ "$got" = "$want" ]; then say "  $3: $key = '$got' (want '$want') ok"; else say "  $3: $key = '$got' (want '$want') FAIL"; ok=0; fi
  done
  [ "$ok" = 1 ]
}

say "WINDOW ${WINDOW[*]} on container=$CONTAINER db=$DB user=$DBUSER at $(utc)"
HEAD="$(git -C "$REPO" rev-parse HEAD)"
DIRTY="$(git -C "$REPO" status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
say "checkout: $HEAD tracked_changes=$DIRTY"
[ "$DIRTY" = "0" ] || stop "the checkout has tracked changes; apply only from a clean checkout of the landed head"
for M in "${WINDOW[@]}"; do
  if grep -q $'\r' "$REPO/${FILE[$M]}"; then stop "${FILE[$M]} has CRLF line endings; apply from a clean LF checkout"; fi
  say "file $M: ${FILE[$M]} sha256=$(sha256sum "$REPO/${FILE[$M]}" | cut -d' ' -f1)"
done
say "server: $(sql_value 'SHOW server_version')  image: $(docker inspect --format '{{.Config.Image}} {{.Image}}' "$CONTAINER")"

# STEP 0: the writers are stopped: no other client session.
OTHERS="$(sql_value "SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()")"
say "step0 other_client_sessions=$OTHERS"
[ "$OTHERS" = "0" ] || stop "other client sessions are connected; stop every writer first"

# STEP 1: a verified backup, before the first migration.
DUMP="/tmp/window-pre-${WINDOW[0]}-$(utc).dump"
docker exec "$CONTAINER" pg_dump -U "$DBUSER" -d "$DB" -Fc -f "$DUMP"
docker exec "$CONTAINER" pg_restore --list "$DUMP" > "$RECORD/backup.toc"
grep -q "relay_wonderland" "$RECORD/backup.toc" || stop "the backup's table of contents lists no relay_wonderland objects"
docker cp "$CONTAINER:$DUMP" "$RECORD/backup.dump" >/dev/null
( cd "$RECORD" && sha256sum backup.dump > backup.dump.sha256 )
SCRATCH="window_verify_$(date -u +%s)"
docker exec "$CONTAINER" psql -X -q -U "$DBUSER" -d "$DB" -c "CREATE DATABASE $SCRATCH" >/dev/null
docker exec "$CONTAINER" pg_restore -U "$DBUSER" -d "$SCRATCH" --no-owner "$DUMP" 2> "$RECORD/backup-restore.stderr" || true
docker exec -i "$CONTAINER" psql -X -q -U "$DBUSER" -d "$SCRATCH" -v ON_ERROR_STOP=1 < "$REPO/docs/julius-migrations/030/rowcounts-store.sql" > "$RECORD/backup-restored.rowcounts"
sql_raw "$REPO/docs/julius-migrations/030/rowcounts-store.sql" > "$RECORD/pre-window.rowcounts"
docker exec "$CONTAINER" psql -X -q -U "$DBUSER" -d "$DB" -c "DROP DATABASE $SCRATCH" >/dev/null
if diff -q "$RECORD/pre-window.rowcounts" "$RECORD/backup-restored.rowcounts" >/dev/null; then
  say "step1 backup verified: restored row counts equal the store's ($(tail -1 "$RECORD/pre-window.rowcounts"))"
else
  diff "$RECORD/pre-window.rowcounts" "$RECORD/backup-restored.rowcounts" | head -20 | tee -a "$SUMMARY"
  stop "the restored backup's row counts differ from the store's"
fi
sql_raw "$REPO/docs/julius-migrations/030/fingerprint-store.sql" > "$RECORD/pre-window.fingerprint"
say "pre-window $(tail -1 "$RECORD/pre-window.fingerprint")"

for M in "${WINDOW[@]}"; do
  say "== $M (${STAMP[$M]})"
  LEDGER_BEFORE="$(sql_value 'SELECT count(*) FROM relay_wonderland.schema_migrations')"
  sql_raw "$REPO/docs/julius-migrations/030/rowcounts-store.sql" > "$RECORD/rowcounts-before-$M.txt"
  sql_file "$REPO/docs/julius-migrations/$M/precheck.sql" > "$RECORD/precheck-$M.txt"
  check_all "${PRE[$M]}" "$RECORD/precheck-$M.txt" "precheck-$M" || stop "$M precheck: a PASS condition is not met (RUNBOOK step 2)"

  set +e
  docker exec -i "$CONTAINER" psql -X -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 < "$REPO/${FILE[$M]}" > "$RECORD/apply-$M.txt" 2>&1
  APPLY_EXIT=$?
  set -e
  echo "exit $APPLY_EXIT" >> "$RECORD/apply-$M.txt"
  say "  apply-$M exit=$APPLY_EXIT $(grep -o "migration_${M}_precheck[^\"]*" "$RECORD/apply-$M.txt" | head -1)"
  [ "$APPLY_EXIT" = "0" ] || stop "$M refused or failed and rolled back (RUNBOOK rollback (a)); see apply-$M.txt"

  sql_file "$REPO/docs/julius-migrations/$M/postcheck.sql" > "$RECORD/postcheck-$M.txt"
  check_all "${POST[$M]}" "$RECORD/postcheck-$M.txt" "postcheck-$M" || stop "$M postcheck: a PASS condition is not met (RUNBOOK step 4)"
  for key in ${SAME[$M]}; do
    a="$(value_of "$key" "$RECORD/precheck-$M.txt")"; b="$(value_of "$key" "$RECORD/postcheck-$M.txt")"
    if [ -n "$a" ] && [ "$a" = "$b" ]; then say "  $key: $a = $b ok"; else stop "$M: $key changed ($a -> $b)"; fi
  done
  LEDGER_AFTER="$(sql_value 'SELECT count(*) FROM relay_wonderland.schema_migrations')"
  LAST="$(sql_value 'SELECT version FROM relay_wonderland.schema_migrations ORDER BY version DESC LIMIT 1')"
  [ "$LEDGER_AFTER" = "$((LEDGER_BEFORE + 1))" ] && [ "$LAST" = "${STAMP[$M]}" ] || stop "$M ledger: count $LEDGER_BEFORE -> $LEDGER_AFTER, last=$LAST"
  say "  ledger: $LEDGER_BEFORE -> $LEDGER_AFTER, last=$LAST ok"

  sql_raw "$REPO/docs/julius-migrations/030/rowcounts-store.sql" > "$RECORD/rowcounts-after-$M.txt"
  if [ "$M" = "033" ]; then
    # 033 only ADDS tables, all empty: every earlier line is unchanged, and every new line is a social_* table at 0 rows.
    removed="$(diff <(grep '^rows ' "$RECORD/rowcounts-before-$M.txt") <(grep '^rows ' "$RECORD/rowcounts-after-$M.txt") | grep '^<' || true)"
    added_bad="$(diff <(grep '^rows ' "$RECORD/rowcounts-before-$M.txt") <(grep '^rows ' "$RECORD/rowcounts-after-$M.txt") | grep '^>' | grep -vE '^> rows relay_wonderland\.social_[a-z_]+ = 0$' || true)"
    [ -z "$removed" ] && [ -z "$added_bad" ] || stop "033 changed existing rows, or added a non-empty or non-social table"
    say "  rows: unchanged; 033 added only empty social_* tables ok"
  else
    diff -q <(grep '^rows ' "$RECORD/rowcounts-before-$M.txt") <(grep '^rows ' "$RECORD/rowcounts-after-$M.txt") >/dev/null \
      || stop "$M changed row counts"
    say "  rows: every table's count unchanged ok"
  fi
  sql_raw "$REPO/docs/julius-migrations/030/fingerprint-store.sql" > "$RECORD/fingerprint-after-$M.txt"
  say "  catalog after $M: $(tail -1 "$RECORD/fingerprint-after-$M.txt")"
done

say "RESULT: PASS (window ${WINDOW[*]} applied; compare the fingerprints with a reference built independently from $HEAD)"
( cd "$RECORD" && sha256sum ./* > ARTIFACTS.sha256 2>/dev/null || true )
exit 0
