#!/usr/bin/env bash
# Regression test: the offer id shown by preflight, the SELECTED_LIVE_ID line, and
# the id in the emitted `vastai create instance <id>` command MUST all be the same.
#
# It stubs `vastai` with a fake that RE-ISSUES a different offer id on every
# `search offers` call (simulating Vast's ephemeral ids). With a single atomic
# selection the three ids match; if anything re-queries the marketplace between
# the preflight display and the emitted command, the ids diverge and this fails.
#
# Zero-spend: the fake never rents (create is plan-only and never calls
# `vastai create`), and nothing here touches the real marketplace.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="$HERE/wonderland-vast.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COUNTER="$TMP/counter"; echo 700000 > "$COUNTER"

# --- fake vastai (drifting offer id) --------------------------------------------
cat > "$TMP/vastai" <<FAKE
#!/usr/bin/env bash
case "\$1 \$2" in
  "--version "*|"--version") echo "1.5.4-fake"; exit 0 ;;
  "show user")      echo '{"id":1,"email":"t@t","credit":50.0,"balance":0}'; exit 0 ;;
  "show instances") echo '[]'; exit 0 ;;
  "search offers")
    n=\$(( \$(cat "$COUNTER") + 1 )); echo "\$n" > "$COUNTER"
    printf '[{"id":%d,"gpu_name":"L40S","num_gpus":1,"gpu_ram":46068,"cpu_cores":128,"cpu_cores_effective":32.0,"cpu_ram":128891,"disk_space":808.0,"direct_port_count":256,"reliability":0.99,"geolocation":"Japan, JP","dph_total":0.6009,"rentable":true}]' "\$n"
    exit 0 ;;
  *) exit 0 ;;
esac
FAKE
chmod +x "$TMP/vastai"

# --- run create with the fake first on PATH (VAST_OFFER_RETRIES=1: no sleeps) ----
out="$(PATH="$TMP:$PATH" VAST_OFFER_RETRIES=1 bash "$TOOL" create 2>&1 || true)"

picked="$(printf '%s\n' "$out" | sed -n 's/.*picked id=\([0-9][0-9]*\).*/\1/p' | head -1)"
selected="$(printf '%s\n' "$out" | sed -n 's/^SELECTED_LIVE_ID=\([0-9][0-9]*\).*/\1/p' | head -1)"
emitted="$(printf '%s\n' "$out" | sed -n 's/^vastai create instance \([0-9][0-9]*\).*/\1/p' | head -1)"

fail() { echo "FAIL: $*"; echo "----- output -----"; printf '%s\n' "$out"; exit 1; }
[ -n "$picked" ]   || fail "no 'picked id=' line (preflight did not select an offer)"
[ -n "$selected" ] || fail "no 'SELECTED_LIVE_ID=' line emitted"
[ -n "$emitted" ]  || fail "no 'vastai create instance <id>' command emitted (preflight blocked?)"
[ "$picked" = "$selected" ] || fail "preflight picked id=$picked but SELECTED_LIVE_ID=$selected (a second marketplace query drifted the id)"
[ "$selected" = "$emitted" ] || fail "SELECTED_LIVE_ID=$selected but emitted create id=$emitted (id not carried through atomically)"

# Sanity: the fake DOES drift — prove the test could have caught a divergence.
a=$(PATH="$TMP:$PATH" vastai search offers x --raw | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
b=$(PATH="$TMP:$PATH" vastai search offers x --raw | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
[ "$a" != "$b" ] || fail "test harness broken: fake vastai did not drift the id ($a==$b)"

echo "PASS: preflight id == SELECTED_LIVE_ID == emitted create id == $emitted (fake drifted $a->$b, so a re-query WOULD have been caught)"
