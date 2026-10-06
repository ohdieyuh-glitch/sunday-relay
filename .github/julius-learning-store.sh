#!/usr/bin/env bash
# DECISION C, OPTION D: A LEARNING PAIR'S STORE, DUMPED BY ARM WITHOUT AND RESTORED BY ARM WITH.
#
#   julius-learning-store.sh dump    <out-dir> <julius-run-id>
#   julius-learning-store.sh restore <dump-file> <without-julius-run-id> <registration-digest>
#
# THE DATABASE COMMANDS AND NOTHING ELSE. The workflow keeps everything that needs GitHub: which run this is, the
# artifact upload and fetch, the digest records, the credential scan with its secret needles. This script holds the
# commands that touch PostgreSQL, so the job that pays and the test that proves it run the SAME ones
# (relay-bridge/julius-learning-store-roundtrip.real-postgres.test.ts runs this file as it is).
#
# ONE ARGUMENT LIST, TWO LAUNCHERS. Every pg_dump / pg_restore / psql argument list is built once (`args_*`). Only
# the launcher differs: with JULIUS_PG_CONTAINER set, `docker exec -i` into that container (the paid job's
# julius-postgres); otherwise the client tools in JULIUS_PG_BINDIR (a throwaway server, a developer's machine). The
# connection is the PG* environment in both, never a URL, so no command line carries a password. Archives move over
# stdin and stdout, so no path inside a container ever enters an argument list. JULIUS_STORE_DRY_RUN=1 prints both
# launchers' commands for the given arguments and runs nothing.
#
# EVERY COMMAND IS PRINTED BEFORE IT RUNS, as `JULIUS_STORE_COMMAND <launcher> <tool> <args>`: names, flags and
# files, never a value from the environment.
set -euo pipefail

die() { echo "$1" >&2; exit 1; }
usage() { die 'usage: julius-learning-store.sh dump <out-dir> <julius-run-id> | restore <dump-file> <without-julius-run-id> <registration-digest>'; }

# The run a learning pair's arm is: an explicit rerun's id (`run:` + 24 hex), exactly as the workflow reads it.
RUN_ID_SHAPE='^run:[0-9a-f]{24}$'
DIGEST_SHAPE='^[0-9a-f]{64}$'

# ---------------------------------------------------------------- the argument lists, built once
args_dump()     { printf '%s\n' --format=custom --compress=0 --no-password; }
args_render()   { printf '%s\n' --file=- --no-password; }
args_restore()  { printf '%s\n' --no-owner --no-privileges --single-transaction --exit-on-error --no-password "--dbname=$PGDATABASE"; }
args_query()    { printf '%s\n' -X --no-password -v ON_ERROR_STOP=1 -At -c "$1"; }
args_version()  { printf '%s\n' --version; }

# ---------------------------------------------------------------- the two launchers
launcher() { if [ -n "${JULIUS_PG_CONTAINER:-}" ]; then echo container; else echo host; fi; }
# prefix <mode> <tool> : the words that launch <tool> in <mode>, one per line. The ONLY place the modes differ.
prefix() {
  local mode=$1 tool=$2
  if [ "$mode" = container ]; then
    printf '%s\n' docker exec -i -e PGUSER -e PGDATABASE -e PGPASSWORD -e PGHOST -e PGPORT "${JULIUS_PG_CONTAINER:-<JULIUS_PG_CONTAINER>}" "$tool"
  else
    local exe="${JULIUS_PG_BINDIR:-<JULIUS_PG_BINDIR>}/$tool"
    if [ -x "$exe.exe" ]; then exe="$exe.exe"; fi
    printf '%s\n' "$exe"
  fi
}
# run_tool <tool> <arg>... : the tool, launched the configured way, its stdin and stdout passed through.
run_tool() {
  local tool=$1; shift
  local mode words=()
  mode=$(launcher)
  if [ "$mode" = host ]; then
    [ -n "${JULIUS_PG_BINDIR:-}" ] || die 'julius_store_no_client: set JULIUS_PG_CONTAINER or JULIUS_PG_BINDIR'
    [ -x "$JULIUS_PG_BINDIR/$tool" ] || [ -x "$JULIUS_PG_BINDIR/$tool.exe" ] || die "julius_store_no_client: $tool is not in $JULIUS_PG_BINDIR"
  fi
  while IFS= read -r word; do words+=("$word"); done < <(prefix "$mode" "$tool")
  "${words[@]}" "$@"
}
# say <tool> <arg>... : the command line, printed to STDERR before it runs (stdout carries archives and SQL).
# Arguments only; no value from the environment is ever echoed.
say() { local tool=$1; shift; echo "JULIUS_STORE_COMMAND $(launcher) $tool $*" >&2; }
# tool <name> <args-builder> [builder-arg] : print, then run, the argument list the builder makes.
tool() {
  local name=$1 builder=$2; shift 2
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <("$builder" "$@")
  say "$name" "${args[@]}"
  run_tool "$name" "${args[@]}"
}

# ---------------------------------------------------------------- the versions, before anything runs
check_versions() {
  local client server client_major server_major
  client=$(tool pg_dump args_version | tail -n 1)
  server=$(tool psql args_query 'SHOW server_version_num' | tail -n 1 | tr -d '\r')
  echo "JULIUS_STORE_VERSIONS client=\"$client\" server_version_num=$server"
  client_major=$(printf '%s' "$client" | sed -n 's/.* \([0-9][0-9]*\)\..*/\1/p' | head -n 1)
  server_major=$((10#${server:0:2}))
  [ -n "$client_major" ] || die "julius_store_client_version_unreadable: $client"
  # A client older than the server cannot dump or restore what the server holds faithfully.
  [ "$client_major" -ge "$server_major" ] || die "julius_store_client_too_old: client $client_major < server $server_major"
}

# ---------------------------------------------------------------- dry run: both launchers, nothing executed
if [ "${JULIUS_STORE_DRY_RUN:-}" = 1 ]; then
  : "${PGDATABASE:=<PGDATABASE>}"
  for mode in container host; do
    for step in 'pg_dump args_dump' 'pg_restore args_render' 'pg_restore args_restore'; do
      read -r name builder <<< "$step"
      echo "JULIUS_STORE_DRY_RUN $mode $builder | $(prefix "$mode" "$name" | tr '\n' ' ')| $("$builder" | tr '\n' ' ' | sed 's/ $//')"
    done
  done
  exit 0
fi

case "${1:-}" in dump|restore) ;; *) usage ;; esac
: "${PGUSER:?missing PGUSER}"; : "${PGDATABASE:?missing PGDATABASE}"
umask 077

case "${1:-}" in
  dump)
    [ "$#" -eq 3 ] || usage
    out=$2; run_id=$3
    [[ "$run_id" =~ $RUN_ID_SHAPE ]] || die "julius_store_run_invalid: '$run_id'"
    mkdir -p "$out"
    render=$(mktemp -d)
    trap 'rm -rf "$render"' EXIT
    check_versions
    # 1. THE STORE, restorable: custom format, uncompressed, over stdout.
    tool pg_dump args_dump > "$out/julius.pgdump"
    # 2. ITS SQL RENDERING, read back from the archive itself (no server), to prove the record is IN the bytes.
    tool pg_restore args_render < "$out/julius.pgdump" > "$render/julius.sql"
    grep -qF "julius-learning-record.v1:$run_id:learning.arm.recorded" "$render/julius.sql" \
      || die 'learning_store_without_record: the store does not hold the WITHOUT record of this run'
    # 3. WHAT WAS DUMPED, said by digest and size (from stdin: sha256sum escapes a file name it dislikes).
    digest=$(sha256sum < "$out/julius.pgdump" | cut -d' ' -f1)
    bytes=$(wc -c < "$out/julius.pgdump" | tr -d ' ')
    printf '%s  julius.pgdump\n' "$digest" > "$out/julius.pgdump.sha256"
    {
      echo 'learning_store_version=1'
      echo "julius_run_id=$run_id"
      echo "dump_sha256=$digest"
      echo "dump_bytes=$bytes"
      echo 'dump_format=pg_dump_custom_uncompressed'
    } > "$out/store-manifest.txt"
    echo "LEARNING_STORE_DUMPED julius_run_id=$run_id dump_sha256=$digest dump_bytes=$bytes"
    ;;
  restore)
    [ "$#" -eq 4 ] || usage
    dump=$2; without=$3; registration=$4
    [ -f "$dump" ] || die "learning_store_dump_missing: $dump"
    [[ "$without" =~ $RUN_ID_SHAPE ]] || die "julius_store_run_invalid: '$without'"
    [[ "$registration" =~ $DIGEST_SHAPE ]] || die 'julius_store_registration_invalid'
    check_versions
    digest=$(sha256sum < "$dump" | cut -d' ' -f1)
    echo "LEARNING_STORE_RESTORING dump_sha256=$digest"
    # 1. RESTORED in one transaction, stopping at the first error: whole, or nothing.
    tool pg_restore args_restore < "$dump"
    # 2. THE RESTORED STORE IS ARM WITHOUT, AND ONLY ARM WITHOUT. The values were shape-checked above.
    q() { tool psql args_query "$1" | tail -n 1 | tr -d '\r'; }
    [ "$(q 'SELECT count(*) FROM relay_wonderland.julius_runs')" = 1 ] \
      || die 'learning_store_not_one_run: the WITHOUT store must hold its own run alone'
    [ "$(q "SELECT state FROM relay_wonderland.julius_runs WHERE run_id = '$without'")" = COMPLETED ] \
      || die "learning_store_without_not_completed: $without"
    [ "$(q "SELECT count(*) FROM relay_wonderland.events WHERE event_type = 'julius.learning.arm.recorded' AND stream_id = '$without' AND payload->'facts'->>'arm' = 'WITHOUT' AND payload->'facts'->>'registrationDigest' = '$registration'")" = 1 ] \
      || die 'learning_store_without_unrecorded: no WITHOUT record under this registration'
    echo "LEARNING_STORE_RESTORED without_julius_run_id=$without dump_sha256=$digest"
    ;;
  *) usage ;;
esac
