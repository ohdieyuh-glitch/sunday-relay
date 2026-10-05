#!/usr/bin/env bash
# THE MIGRATION WINDOW, AS ONE PROCEDURE: 031 then 032 (then 033, 034 and 035 when asked), exactly as their runbooks say, recorded.
#
# Each migration's RUNBOOK.md is the authority; this wrapper only runs its steps in order and refuses to continue past
# any condition the runbook says to STOP on. For every migration M in the window:
#   precheck  docs/julius-migrations/M/precheck.sql      -> its PASS conditions, read back from its own output
#   apply     the landed migration file, ON_ERROR_STOP    -> exit 0 required; its NOTICE lines kept
#   postcheck docs/julius-migrations/M/postcheck.sql     -> its PASS conditions, plus the comparisons with the precheck
#   ledger    the ledger's last stamp must be M's, and its count one more than before
#   rows      R1 row counts (030/rowcounts-store.sql) unchanged by M, table for table (033 and 035 may only ADD empty tables)
#   catalog   R1 fingerprint (030/fingerprint-store.sql) recorded after M, for Second's comparison with a reference;
#             034 (reserved: a ledger row and nothing else) must leave it IDENTICAL
# Before the first migration: no other client session may be connected (the writers are stopped), and a verified
# backup is taken (pg_dump -Fc, its TOC checked, restored into a scratch database and its row counts compared).
#
# THE SAME SCRIPT RUNS THE REHEARSAL AND THE REAL WINDOW. What was rehearsed is what runs.
# The live store (container julius-postgres) is refused unless --live is given with the exact phrase
#   "APPLY THE WINDOW TO THE LIVE STORE"
# and DATABASE_URL is never read, set or restored here (founder ruling R-6).
#
# Usage:
#   window.sh --container NAME --through 032|033|034|035 --record DIR [--repo PATH] [--db julius] [--user julius] [--live PHRASE]
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
[ -n "$CONTAINER" ] && [ -n "$THROUGH" ] && [ -n "$RECORD" ] || { echo "usage: window.sh --container NAME --through 032|033|034|035 --record DIR" >&2; exit 1; }
case "$THROUGH" in
  032) WINDOW=(031 032) ;;
  033) WINDOW=(031 032 033) ;;
  034) WINDOW=(031 032 033 034) ;;
  035) WINDOW=(031 032 033 034 035) ;;
  *) echo "--through must be 032, 033, 034 or 035" >&2; exit 1 ;;
esac
if [ "$CONTAINER" = "julius-postgres" ] && [ "$LIVE" != "APPLY THE WINDOW TO THE LIVE STORE" ]; then
  echo "REFUSED: julius-postgres is the live store; pass --live \"APPLY THE WINDOW TO THE LIVE STORE\" on a recorded decision" >&2; exit 1
fi

declare -A STAMP=(
  [030]=030_julius_outbox_event_no_reread
  [031]=031_julius_run_transition_hot
  [032]=032_julius_outbox_event_delete_forgets
  [033]=033_wonderland_social
  [034]=034_julius_project_brain_reserved
  [035]=035_wonderland_voice
)
declare -A FILE=(
  [031]=src/relay/persistence/wonderland-migrations/031_julius_run_transition_hot.sql
  [032]=src/relay/persistence/wonderland-migrations/032_julius_outbox_event_delete_forgets.sql
  [033]=src/relay/persistence/wonderland-migrations/033_wonderland_social.sql
  [034]=src/relay/persistence/wonderland-migrations/034_julius_project_brain_reserved.sql
  [035]=src/relay/persistence/wonderland-migrations/035_wonderland_voice.sql
)
# PASS conditions, transcribed from each RUNBOOK.md (step 2: precheck; step 4: postcheck). key=value, value may be empty.
declare -A PRE=(
  [031]="old_index_matches=t new_name_free=t migration_030_applied=t migration_031_applied=f"
  [032]="delete_trigger_matches=t registry_triggers_match=t function_is_030=t function_has_forget=f remember_is_030=t remember_has_filter=f orphan_outbox_rows=0 migration_030_applied=t migration_031_applied=t migration_032_applied=f ledger_last=031_julius_run_transition_hot"
  [033]="migration_032_applied=t migration_033_applied=f social_tables_present=0 ledger_last=032_julius_outbox_event_delete_forgets"
  [034]="migration_033_applied=t any_034_applied=f ledger_last=033_wonderland_social"
  [035]="migration_033_applied=t migration_034_applied=t migration_035_applied=f voice_tables_present=0 ledger_last=034_julius_project_brain_reserved"
)
declare -A POST=(
  [031]="old_index_present=f new_index_matches=t update_columns_indexed= migration_031_applied=t"
  [032]="delete_trigger_matches=t registry_triggers_match=t function_is_030=f function_has_forget=t remember_is_030=f remember_has_filter=t orphan_outbox_rows=0 migration_032_applied=t ledger_last=032_julius_outbox_event_delete_forgets"
  [033]="migration_033_applied=t ledger_last=033_wonderland_social social_tables_present=15 social_rows=0 recent_players_columns=0"
  [034]="migration_034_applied=t stamps_034=1 ledger_last=034_julius_project_brain_reserved"
  [035]="migration_035_applied=t ledger_last=035_wonderland_voice voice_tables_present=3 voice_rows=0 token_columns=0"
)
# Values the postcheck must repeat from the precheck (RUNBOOK step 4: "equals step 2's").
declare -A SAME=( [031]="runs_rows" [032]="events_rows outbox_rows" [033]="players_rows" [034]="relay_wonderland_tables players_rows" [035]="players_rows" )
# The migrations that may ADD tables, all empty and all named with this prefix; every other migration changes no row count.
declare -A ADDS=( [033]=social [035]=voice )

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
# Row-count lines except the ledger's own table: a migration adds exactly one ledger row, which the ledger check proves.
data_rows() { grep '^rows ' "$1" | grep -v '^rows relay_wonderland\.schema_migrations = ' ; }
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
PREV_FP="$(tail -1 "$RECORD/pre-window.fingerprint")"

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
  notice="$(grep -o "migration_${M}_precheck[^\"]*" "$RECORD/apply-$M.txt" | head -1 || true)"
  say "  apply-$M exit=$APPLY_EXIT${notice:+ $notice}"
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
  if [ -n "${ADDS[$M]:-}" ]; then
    # 033 and 035 only ADD tables, all empty: every earlier line is unchanged, and every new line is one of M's tables at 0 rows.
    prefix="${ADDS[$M]}"
    removed="$(diff <(data_rows "$RECORD/rowcounts-before-$M.txt") <(data_rows "$RECORD/rowcounts-after-$M.txt") | grep '^<' || true)"
    added_bad="$(diff <(data_rows "$RECORD/rowcounts-before-$M.txt") <(data_rows "$RECORD/rowcounts-after-$M.txt") | grep '^>' | grep -vE "^> rows relay_wonderland\.${prefix}_[a-z_]+ = 0$" || true)"
    [ -z "$removed" ] && [ -z "$added_bad" ] || stop "$M changed existing rows, or added a non-empty table or one not named ${prefix}_*"
    say "  rows: unchanged; $M added only empty ${prefix}_* tables ok"
  else
    diff -q <(data_rows "$RECORD/rowcounts-before-$M.txt") <(data_rows "$RECORD/rowcounts-after-$M.txt") >/dev/null \
      || stop "$M changed row counts"
    say "  rows: every table's count unchanged (the ledger aside, +1 above) ok"
  fi
  sql_raw "$REPO/docs/julius-migrations/030/fingerprint-store.sql" > "$RECORD/fingerprint-after-$M.txt"
  FP="$(tail -1 "$RECORD/fingerprint-after-$M.txt")"
  say "  catalog after $M: $FP"
  if [ "$M" = "034" ]; then
    # The reserved 034 writes its ledger row and nothing else: the catalog is exactly what it was.
    [ "$FP" = "$PREV_FP" ] || stop "034 changed the catalog ($PREV_FP -> $FP); the reserved 034 may write only its ledger row"
    say "  catalog: identical before and after 034 ok"
  fi
  PREV_FP="$FP"
done

say "RESULT: PASS (window ${WINDOW[*]} applied; compare the fingerprints with a reference built independently from $HEAD)"
( cd "$RECORD" && sha256sum ./* > ARTIFACTS.sha256 2>/dev/null || true )
exit 0
