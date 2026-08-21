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
echo "-- the visual acceptance target --"
VT="$HERE/../infra/build/verify-visual-target.py"
python3 -c "import ast,io;ast.parse(io.open('$VT',encoding='utf8').read())"
check $? "verify-visual-target.py parses"
python3 -c "import io,json;json.load(io.open('$HERE/../WorldDesign/visual-target.json',encoding='utf8'))"
check $? "visual-target.json parses"
python3 - "$HERE" <<'VTFACTS'
import io, json, os, sys
root = sys.argv[1]
target = json.load(io.open(os.path.join(root, "..", "WorldDesign", "visual-target.json"),
                           encoding="utf8"))
# Every criterion must carry a metric AND a reason. A threshold with no stated
# reason is a number nobody can argue with, which is how a target stops being
# a target and becomes folklore.
bad = [n for n, r in target["criteria"].items()
       if not r.get("metric") or len(r.get("why", "")) < 30]
# And it must not claim to score the frame against the reference.
blob = json.dumps(target).lower()
claims = [w for w in ("similarity", "match score", "ssim", "psnr") if w in blob]
sys.exit(0 if not bad and not claims else
         (print("no-reason:", bad, "score-claims:", claims) or 1))
VTFACTS
check $? "every criterion has a metric and a stated reason, and none claims a score"
# The 20-65 degree hue band covers gold leaf, tree bark AND warm paving. As one
# bucket it read 28.3% and said "gold dominates the frame"; split, real gold is
# 13.0% and inside its accent band. Merging them again would resurrect a
# finding that sends someone to de-gold a world that is not over-gold.
grep -q "warm_timber_stone" "$HERE/../infra/build/verify-hero-composition.py"
check $? "the warm hue band separates bright gold from timber and paving"
grep -q "palette_contributors" "$HERE/../infra/build/verify-hero-composition.py"
check $? "each colour family names the materials that put it on screen"

# The gate must FAIL on a frame that misses a target, and must fail on a frame
# it could not measure. A gate that skips what it cannot read passes as it
# stops working.
python3 - "$TMP" <<'MKFACTS'
import io, json, os, sys
tmp = sys.argv[1]
good = {"coverage": {"objects_pct": 95.0, "sky_pct": 5.0, "bare_ground_pct": 0.1},
        "distinct_materials_visible": 40,
        "depth_pixels": {"near": 30.0, "mid": 50.0, "far": 10.0},
        "lone_primitive_pct": 0.5,
        "relay_dogs": {"readable": 5, "tallest_px": 150},
        "palette_pct": {"cream_white": 20.0, "pink_rose_red": 14.0,
                        "violet_purple": 8.0, "gold_amber": 10.0,
                        "green_foliage": 18.0}}
json.dump(good, io.open(os.path.join(tmp, "good.json"), "w", encoding="utf8"))
barren = json.loads(json.dumps(good))
barren["coverage"]["bare_ground_pct"] = 9.0
barren["lone_primitive_pct"] = 7.0
json.dump(barren, io.open(os.path.join(tmp, "barren.json"), "w", encoding="utf8"))
nodogs = json.loads(json.dumps(good))
nodogs["relay_dogs"] = {"readable": 0, "tallest_px": 0}
json.dump(nodogs, io.open(os.path.join(tmp, "nodogs.json"), "w", encoding="utf8"))
json.dump({"coverage": {}}, io.open(os.path.join(tmp, "empty.json"), "w", encoding="utf8"))
MKFACTS
python3 "$VT" --facts "$TMP/good.json" >/dev/null 2>&1
check $? "a frame meeting every target PASSES"
python3 "$VT" --facts "$TMP/barren.json" >/dev/null 2>&1
[ $? -ne 0 ]; check $? "bare ground and primitive spam FAIL the gate"
python3 "$VT" --facts "$TMP/nodogs.json" >/dev/null 2>&1
[ $? -ne 0 ]; check $? "a frame with no readable Relay Dog FAILS the gate"
python3 "$VT" --facts "$TMP/empty.json" >/dev/null 2>&1
[ $? -ne 0 ]; check $? "facts it cannot read FAIL rather than being skipped"
# Captured to a file, not piped: this harness runs under `pipefail`, and the
# gate is SUPPOSED to exit non-zero here — piping it into grep hands grep's
# success back as the gate's failure, and the check fails for the one reason
# that has nothing to do with what it is checking.
python3 "$VT" --facts "$TMP/empty.json" >"$TMP/unmeasured.txt" 2>&1 || true
grep -q "NOT MEASURED" "$TMP/unmeasured.txt"
check $? "...and the unmeasured criteria are named"

echo
echo "-- the before/after report --"
python3 -c "import ast,io;ast.parse(io.open('$HERE/compare.py',encoding='utf8').read())"
check $? "compare.py parses"
export WL_PROOF="$TMP/proof"
python3 - "$TMP" <<'MKBENCH'
import io, json, os, sys
tmp = sys.argv[1]
def write(label, profile, execcmds, fps, status="ok"):
    d = os.path.join(tmp, "proof", "bench", label)
    os.makedirs(d, exist_ok=True)
    json.dump({"label": label, "profile": profile, "exec_cmds": execcmds,
               "gpu": "NVIDIA L4, 23034 MiB",
               "runs": [{"camera": "0", "status": status,
                         "stream": {"fps_p50": fps, "fps_min": fps - 4,
                                    "bitrate_kbps": 4200.0, "resolution": "1280x720",
                                    "freeze_count": 0, "mean_decode_ms": 1.4},
                         "gpu": {"gpu_util_mean_pct": 61.0, "vram_used_max_mib": 4100.0},
                         "screenshot": None}]},
              io.open(os.path.join(d, "report.json"), "w", encoding="utf8"))
write("b1", "BALANCED", "r.ScreenPercentage 100,r.MotionBlurQuality 0", 58.0)
write("b2", "CINEMATIC", "r.ScreenPercentage 150,r.MotionBlurQuality 0", 41.0)
write("b3", "BALANCED", "r.ScreenPercentage 100,r.MotionBlurQuality 0", 57.0)
write("b4", "BALANCED", "r.ScreenPercentage 100,r.MotionBlurQuality 0", 30.0, status="FAILED: nothing streamed")
MKBENCH
python3 "$HERE/compare.py" b1 b2 --out "$TMP/rep.html" >/dev/null 2>&1
check $? "compare.py builds a report from two bench runs"
grep -q "r.ScreenPercentage" "$TMP/rep.html"
check $? "the report shows WHICH console variable differed"
grep -q "150" "$TMP/rep.html"; check $? "...and both values"
grep -qi "no image-match score" "$TMP/rep.html"
check $? "the report states plainly that it does not score the images"
# Look for a NUMBER presented as a likeness, not for the words: the report's
# own disclaimer contains the phrase "image-match score", and a check that its
# own honesty trips is a check that will be deleted rather than fixed.
! grep -qiE "([0-9]+(\.[0-9]+)?[ ]*%?[ ]*(similar|match|likeness))|((similarity|match[ -]?score|ssim|psnr)[ ]*[:=][ ]*[0-9])" "$TMP/rep.html"
check $? "no NUMBER is presented as an image likeness anywhere in it"
python3 "$HERE/compare.py" b1 b3 --out "$TMP/rep2.html" 2>&1 | grep -q "identical console variables"
check $? "two runs with identical settings are called out, not silently compared"
python3 "$HERE/compare.py" b1 b4 --out "$TMP/rep3.html" 2>&1 | grep -q "produced no measurement"
check $? "a failed run is flagged rather than counted as a result"
grep -q "not evidence of anything" "$TMP/rep3.html"
check $? "...and the report says so too"
unset WL_PROOF

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
