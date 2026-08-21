#!/usr/bin/env bash
# Offline gates for the rendering profiles. No GPU, no engine, seconds.
#
# The failure these guard against is not a wrong value — a wrong value shows up
# in the bench. It is a setting that LOOKS applied and is not: a comment that
# claims a console variable is passed while the command line does not carry it,
# a payload with spaces split into switches Unreal ignores in silence, a name
# the engine does not have. Each of those has already happened here at least
# once, and none of them announces itself at run time.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$1" = "0" ]; then ok "$2"; else bad "$2"; fi }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PROBE="$HERE/engine-cvars.5.8.json"
SAVED=""
if [ -f "$PROBE" ]; then SAVED="$TMP/saved-probe.json"; cp "$PROBE" "$SAVED"; rm -f "$PROBE"; fi
restore() { [ -n "$SAVED" ] && cp "$SAVED" "$PROBE" || rm -f "$PROBE"; }
trap 'restore; rm -rf "$TMP"' EXIT

echo "-- the profile file itself --"
python3 "$HERE/render-profile.py" check >/dev/null 2>&1
check $? "profiles.json passes its own check"

python3 - "$HERE" <<'PY' >"$TMP/rejected.txt" 2>&1
import io, json, os, sys
data = json.load(io.open(os.path.join(sys.argv[1], "profiles.json"), encoding="utf8"))
rejected = set(data.get("rejected", {}))
applied = set()
for profile in data["profiles"].values():
    applied |= set(profile["cvars"])
overlap = applied & rejected
print("OVERLAP" if overlap else "CLEAN", sorted(overlap))
# The two the founder named explicitly must be REJECTED, with a reason, not
# merely absent — "we did not use it" and "it does nothing under TSR" are
# different answers and only one of them survives being asked again.
for name in ("r.TemporalAACurrentFrameWeight", "r.TemporalAASamples"):
    print("REASONED" if len(data["rejected"].get(name, "")) > 40 else "THIN", name)
PY
grep -q "^CLEAN" "$TMP/rejected.txt"; check $? "no profile applies a CVar the file also rejects"
[ "$(grep -c '^REASONED' "$TMP/rejected.txt")" = "2" ]
check $? "both named TAA CVars are rejected WITH a reason, not silently omitted"

echo
echo "-- every applied name is offered to the probe --"
python3 - "$HERE" <<'PY'
import io, json, os, subprocess, sys
root = sys.argv[1]
data = json.load(io.open(os.path.join(root, "profiles.json"), encoding="utf8"))
applied = set()
for profile in data["profiles"].values():
    applied |= set(profile["cvars"])
listed = set(subprocess.run([sys.executable, os.path.join(root, "collect-cvar-names.py")],
                            capture_output=True, text=True).stdout.split())
missing = applied - listed
sys.exit(0 if not missing else (print("missing from the probe list:", missing) or 1))
PY
check $? "collect-cvar-names.py covers every CVar any profile applies"

echo
echo "-- the gate --"
python3 "$HERE/render-profile.py" --strict emit BALANCED >/dev/null 2>&1
[ $? -ne 0 ]; check $? "--strict REFUSES while the engine is unprobed"
OUT="$(python3 "$HERE/render-profile.py" emit BALANCED 2>"$TMP/warn.txt")"
[ -n "$OUT" ]; check $? "non-strict still emits (otherwise the first probe could never run)"
grep -q "UNPROBED" "$TMP/warn.txt"; check $? "…and says loudly on stderr that nothing is verified"

# A probe that says the engine lacks a CVar must turn emit into a refusal.
python3 - "$HERE" <<'PY'
import io, json, os, sys
root = sys.argv[1]
data = json.load(io.open(os.path.join(root, "profiles.json"), encoding="utf8"))
names = set()
for profile in data["profiles"].values():
    names |= set(profile["cvars"])
verdicts = {n: "present" for n in names}
verdicts["r.TSR.History.SampleCount"] = "absent"
json.dump({"engine": "5.8", "verdicts": verdicts, "counts": {"present": len(names)}},
          io.open(os.path.join(root, "engine-cvars.5.8.json"), "w", encoding="utf8"))
PY
python3 "$HERE/render-profile.py" emit BALANCED >/dev/null 2>"$TMP/refuse.txt"
[ $? -ne 0 ]; check $? "a probed-ABSENT CVar turns emit into a refusal"
grep -q "r.TSR.History.SampleCount" "$TMP/refuse.txt"; check $? "…and names the offending CVar"
python3 "$HERE/render-profile.py" check >/dev/null 2>&1
[ $? -ne 0 ]; check $? "check also fails when a profile applies a CVar the engine lacks"

# All present -> emit succeeds and the payload is safe to pass as one argument.
python3 - "$HERE" <<'PY'
import io, json, os, sys
root = sys.argv[1]
data = json.load(io.open(os.path.join(root, "profiles.json"), encoding="utf8"))
names = set()
for profile in data["profiles"].values():
    names |= set(profile["cvars"])
json.dump({"engine": "5.8", "verdicts": {n: "present" for n in names},
           "counts": {"present": len(names)}},
          io.open(os.path.join(root, "engine-cvars.5.8.json"), "w", encoding="utf8"))
PY
PAYLOAD="$(python3 "$HERE/render-profile.py" --strict emit BALANCED 2>/dev/null)"
[ -n "$PAYLOAD" ]; check $? "with a clean probe, --strict emits the payload"
case "$PAYLOAD" in
  *'"'*|*'$'*|*'`'*|*';'*|*'&'*) bad "the payload contains shell metacharacters" ;;
  *) ok "the payload contains no shell metacharacters" ;;
esac
echo "$PAYLOAD" | grep -q "r.AutoExposure.Bias -3.4"
check $? "the exposure bias is IN the payload (it was missing from the launcher entirely)"

echo
echo "-- the launcher actually carries what the comments claim --"
RS="$HERE/../infra/lightning/run-stream.sh"
grep -q '\-ExecCmds=' "$RS"; check $? "run-stream.sh passes -ExecCmds"
grep -q 'render-profile.py' "$RS"; check $? "run-stream.sh resolves the profile rather than hardcoding CVars"
# The payload has spaces. If it is ever expanded unquoted it becomes a dozen
# switches Unreal drops in silence, which is indistinguishable from success.
grep -q '"\${exec_arg\[@\]' "$RS"; check $? "the -ExecCmds argument is expanded QUOTED"
grep -q 'WL_HERO_CAM' "$RS"; check $? "run-stream.sh honours the deterministic hero camera"
grep -q 'render-launch.txt' "$RS"; check $? "run-stream.sh records what it actually launched"
! grep -q 'WL_EXTRA_ARGS="-ExecCmds' "$HERE/bench.sh"
check $? "bench.sh does NOT smuggle -ExecCmds through the word-splitting variable"
grep -q 'strict emit' "$HERE/bench.sh"; check $? "bench.sh resolves the profile in strict mode"

echo
echo "-- the probe parser --"
cat > "$TMP/names.txt" <<'NAMES'
r.Present.One
r.Absent.One
r.Silent.One
NAMES
cat > "$TMP/probe.log" <<'LOG'
LogConsoleResponse: r.Present.One = 4
LogConsoleManager: Warning: Command not recognized: r.Absent.One
LOG
python3 "$HERE/parse-cvar-probe.py" "$TMP/names.txt" "$TMP/probe.log" "$TMP/out.json" >/dev/null 2>&1
check $? "parse-cvar-probe.py runs"
python3 - "$TMP/out.json" <<'PY'
import io, json, sys
d = json.load(io.open(sys.argv[1], encoding="utf8"))["verdicts"]
want = {"r.Present.One": "present", "r.Absent.One": "absent", "r.Silent.One": "silent"}
bad = {k: (d.get(k), v) for k, v in want.items() if d.get(k) != v}
sys.exit(0 if not bad else (print("misclassified:", bad) or 1))
PY
check $? "present / absent / SILENT are three distinct verdicts"
cat > "$TMP/empty.log" <<'LOG'
the app crashed before it reached a console
LOG
python3 "$HERE/parse-cvar-probe.py" "$TMP/names.txt" "$TMP/empty.log" "$TMP/out2.json" >/dev/null 2>&1
python3 -c "
import io,json,sys
d=json.load(io.open('$TMP/out2.json',encoding='utf8'))
sys.exit(0 if d.get('warning') else 1)"
check $? "a probe where NOTHING answered warns instead of declaring everything absent"

echo
echo "-- the draw-cost audit --"
python3 -c "import ast,io;ast.parse(io.open('$HERE/audit-draw-cost.py',encoding='utf8').read())"
check $? "audit-draw-cost.py parses"
# generate-hub-level.py builds at import time when `unreal` is not None, and the
# stub makes it not None. Forgetting to clear the recorder between the module
# exec and the explicit build() doubles every figure the audit reports — which
# is the most convincing kind of wrong: internally consistent, plausible, 2x.
# It happened while this file was being written.
grep -q "preview.records\[:\] = \[\]" "$HERE/audit-draw-cost.py"
check $? "the audit drops the module-level build before measuring"
grep -q "hub-layout.json" "$HERE/audit-draw-cost.py"
check $? "the audit builds from the real layout, not a default one"

echo
echo "-- the measurement instrument --"
node --check "$HERE/measure.cjs" >/dev/null 2>&1
check $? "measure.cjs parses"
grep -q "channel: 'chrome'" "$HERE/measure.cjs"
check $? "measure.cjs uses real Chrome (bundled Chromium has no H264 decoder)"
grep -q "bytesReceived" "$HERE/measure.cjs"
check $? "bitrate comes from the monotonic byte counter, not an instantaneous field"
bash -n "$HERE/bench.sh"; check $? "bench.sh parses"
python3 -c "import ast,io;ast.parse(io.open('$HERE/bench-row.py',encoding='utf8').read())"
check $? "bench-row.py parses"
grep -q "FAILED: the stream produced no measurable frames" "$HERE/bench-row.py"
check $? "a run that streamed nothing is recorded as FAILED, not as zero FPS"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
