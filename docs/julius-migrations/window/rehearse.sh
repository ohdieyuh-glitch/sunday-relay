#!/usr/bin/env bash
# THE WINDOW'S DOCKER REHEARSAL. A throwaway postgres:16 container stands in for julius-postgres; the store is brought
# to 030 from this checkout's own migration files, seeded with the live store's shapes, and then:
#   R1  NEGATIVE: 032 at 030 is refused, and the catalog and rows are unchanged.
#   R2  THE WINDOW: window.sh, the very script the live window runs, end to end (backup, checks, applies, comparisons).
#   R3  NEGATIVE: 031 applied a second time is refused, and nothing changes.
#   R4  ROLLBACK: 032's DOWN, then 031's DOWN, return the catalog to the pre-window fingerprint and the rows to the
#       pre-window counts, exactly.
#   R5  DETERMINISM: the window applied again over the rolled-back store reaches the same catalog fingerprint as R2.
# Never touches julius-postgres. Never reads or sets DATABASE_URL.
#
# Usage: rehearse.sh --through 032|033 --record DIR [--image postgres:16] [--keep]
# Exit: 0 every rehearsal step passed; 2 a step failed (RESULT line says which); 1 usage or environment.
set -euo pipefail
THROUGH=""; RECORD=""; IMAGE="postgres:16"; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --through) THROUGH="$2"; shift 2 ;;
    --record) RECORD="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
[ -n "$THROUGH" ] && [ -n "$RECORD" ] || { echo "usage: rehearse.sh --through 032|033 --record DIR" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIG="$REPO/src/relay/persistence/wonderland-migrations"
NAME="julius-window-rehearsal-$(date -u +%s)"
mkdir -p "$RECORD"
LOG="$RECORD/REHEARSAL.txt"
: > "$LOG"
say() { echo "$*" | tee -a "$LOG"; }
fail() { say "FAIL: $*"; say "RESULT: FAIL"; exit 2; }
cleanup() { if [ "$KEEP" = 0 ]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
psql_in() { docker exec -i "$NAME" psql -X -q -U julius -d julius -v ON_ERROR_STOP=1 "$@"; }
fingerprint() { psql_in < "$REPO/docs/julius-migrations/030/fingerprint-store.sql" | tail -1; }
rowcounts() { psql_in < "$REPO/docs/julius-migrations/030/rowcounts-store.sql"; }
committed() { sed -E '/^\\set ON_ERROR_STOP on[[:space:]]*$/d' "$1"; }

say "REHEARSAL through $THROUGH, image $IMAGE, container $NAME, checkout $(git -C "$REPO" rev-parse HEAD) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker run -d --name "$NAME" -e POSTGRES_USER=julius -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=julius "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U julius -d julius >/dev/null 2>&1 && break; sleep 1; done
# The entrypoint restarts the server once after initialisation; wait for the restarted server to accept a query.
for _ in $(seq 1 60); do psql_in -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
say "server $(psql_in -A -t -c 'SHOW server_version')"

# The store at 030, from this checkout's own files, in order.
for file in $(ls "$MIG" | sort); do
  version="${file%%_*}"
  [ "$((10#$version))" -le 30 ] || continue
  psql_in < "$MIG/$file" > /dev/null || fail "migration $file did not apply while building the 030 store"
done
psql_in < "$HERE/seed-at-030.sql" > /dev/null || fail "the seed did not apply"
say "store at 030: ledger_last=$(psql_in -A -t -c 'SELECT version FROM relay_wonderland.schema_migrations ORDER BY version DESC LIMIT 1') $(rowcounts | tail -1)"
PRE_FP="$(fingerprint)"; rowcounts > "$RECORD/pre-window.rowcounts"
say "pre-window $PRE_FP"

# R1: 032 before 031 is refused and changes nothing.
set +e; psql_in < "$MIG/032_julius_outbox_event_delete_forgets.sql" > "$RECORD/r1-032-at-030.txt" 2>&1; R1=$?; set -e
grep -q "migration_032_refused" "$RECORD/r1-032-at-030.txt" || fail "R1: 032 at 030 did not raise migration_032_refused (exit $R1)"
[ "$(fingerprint)" = "$PRE_FP" ] && diff -q <(rowcounts) "$RECORD/pre-window.rowcounts" >/dev/null || fail "R1: the refused 032 changed something"
say "R1 PASS: 032 at 030 refused (exit $R1), catalog and rows unchanged"

# R2: the window, by the script the live window runs.
"$HERE/window.sh" --container "$NAME" --through "$THROUGH" --record "$RECORD/window" --repo "$REPO" || fail "R2: the window did not pass; see window/SUMMARY.txt"
POST_FP="$(fingerprint)"; rowcounts > "$RECORD/post-window.rowcounts"
say "R2 PASS: the window applied ($(grep -c ' ok$' "$RECORD/window/SUMMARY.txt") conditions ok); post-window $POST_FP"

# R3: 031 a second time is refused and changes nothing.
set +e; psql_in < "$MIG/031_julius_run_transition_hot.sql" > "$RECORD/r3-031-again.txt" 2>&1; R3=$?; set -e
grep -q "migration_031_refused" "$RECORD/r3-031-again.txt" || fail "R3: 031 again did not raise migration_031_refused (exit $R3)"
[ "$(fingerprint)" = "$POST_FP" ] || fail "R3: the refused 031 changed the catalog"
say "R3 PASS: 031 again refused (exit $R3), catalog unchanged"

# R4: rollback, newest first, to the pre-window store exactly.
if [ "$THROUGH" = "033" ]; then
  committed "$REPO/docs/julius-migrations/033/down.sql" | psql_in > "$RECORD/r4-down-033.txt" 2>&1 || fail "R4: 033 DOWN failed"
fi
committed "$REPO/docs/julius-migrations/032/down.sql" | psql_in > "$RECORD/r4-down-032.txt" 2>&1 || fail "R4: 032 DOWN failed"
committed "$REPO/docs/julius-migrations/031/down.sql" | psql_in > "$RECORD/r4-down-031.txt" 2>&1 || fail "R4: 031 DOWN failed"
BACK_FP="$(fingerprint)"
[ "$BACK_FP" = "$PRE_FP" ] || fail "R4: after DOWN the catalog is $BACK_FP, not the pre-window $PRE_FP"
diff -q <(rowcounts) "$RECORD/pre-window.rowcounts" >/dev/null || fail "R4: after DOWN the row counts differ from the pre-window store"
say "R4 PASS: DOWN returned the catalog and the rows to the pre-window store exactly"

# R5: the window again reaches the same catalog.
"$HERE/window.sh" --container "$NAME" --through "$THROUGH" --record "$RECORD/window-again" --repo "$REPO" || fail "R5: the second window did not pass"
AGAIN_FP="$(fingerprint)"
[ "$AGAIN_FP" = "$POST_FP" ] || fail "R5: the second window reached $AGAIN_FP, not $POST_FP"
say "R5 PASS: the window is deterministic ($AGAIN_FP)"

say "RESULT: PASS"
( cd "$RECORD" && find . -type f ! -name 'ARTIFACTS.sha256' -print0 | sort -z | xargs -0 sha256sum > ARTIFACTS.sha256 )
