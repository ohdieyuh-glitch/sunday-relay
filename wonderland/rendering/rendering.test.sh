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
# A PROBE THAT ANSWERED FOR NOTHING must refuse in strict mode. Silent names
# are filtered out of the payload rather than refused, so without this a hung
# or crashed probe yields an EMPTY -ExecCmds that reports success — and the
# bench then measures engine defaults under a profile's name. Reproduced by
# pointing probe-cvars.sh at a process that only sleeps.
python3 - "$HERE" <<'DEADPROBE'
import io, json, os, sys
root = sys.argv[1]
data = json.load(io.open(os.path.join(root, "profiles.json"), encoding="utf8"))
names = set()
for profile in data["profiles"].values():
    names |= set(profile["cvars"])
json.dump({"engine": "5.8", "verdicts": {n: "silent" for n in names},
           "counts": {"present": 0, "absent": 0, "silent": len(names)},
           "warning": "not one name was answered."},
          io.open(os.path.join(root, "engine-cvars.5.8.json"), "w", encoding="utf8"))
DEADPROBE
python3 "$HERE/render-profile.py" --strict emit BALANCED >/dev/null 2>&1
[ $? -ne 0 ]; check $? "a probe that answered for NOTHING refuses in strict mode"
# Captured, not piped: this harness runs under pipefail and the gate is
# SUPPOSED to exit non-zero here, so a pipeline hands grep's success back as
# the gate's failure. Third time in this file — the pattern is the hazard.
python3 "$HERE/render-profile.py" --strict emit BALANCED >/dev/null 2>"$TMP/dead.txt" || true
grep -q "did not measure this engine" "$TMP/dead.txt"
check $? "...and says the probe did not measure the engine"
DEAD_PAYLOAD="$(python3 "$HERE/render-profile.py" --strict emit BALANCED 2>/dev/null || true)"
[ -z "$DEAD_PAYLOAD" ]; check $? "...and emits nothing rather than an empty payload that looks fine"

python3 - "$HERE" <<'GOODPROBE'
import io, json, os, sys
root = sys.argv[1]
data = json.load(io.open(os.path.join(root, "profiles.json"), encoding="utf8"))
names = set()
for profile in data["profiles"].values():
    names |= set(profile["cvars"])
json.dump({"engine": "5.8", "verdicts": {n: "present" for n in names},
           "counts": {"present": len(names)}},
          io.open(os.path.join(root, "engine-cvars.5.8.json"), "w", encoding="utf8"))
GOODPROBE
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
echo "-- the batched world architecture --"
SRC="$HERE/../Source/Wonderland"
GEN="$HERE/../infra/build/generate-hub-level.py"
DRY="$HERE/../infra/build/verify-generator-dryrun.py"

# THE MEASUREMENT THIS EXISTS FOR: an NVIDIA L4 rendered the unbatched world at
# 12 FPS with the GPU at 10% and the RenderThread pinned. The cost was 33,149
# actors, not shading. These checks are what stop it coming back.
[ -f "$SRC/WonderlandInstancedBatch.h" ] && [ -f "$SRC/WonderlandInstancedBatch.cpp" ]
check $? "AWonderlandInstancedBatch exists"
grep -q "bCanEverTick = false" "$SRC/WonderlandInstancedBatch.cpp"
check $? "batch actors do not tick (a few hundred idle ticks is a real GameThread slice)"
grep -q "ECollisionEnabled::NoCollision" "$SRC/WonderlandInstancedBatch.cpp"
check $? "instanced decoration has no collision"
grep -q "SetCanEverAffectNavigation(false)" "$SRC/WonderlandInstancedBatch.cpp"
check $? "instanced decoration contributes no navigation"
grep -q "EComponentMobility::Movable" "$SRC/WonderlandInstancedBatch.cpp"
check $? "instances default to MOVABLE (Static renders black without baked lighting here)"
grep -q "bReplicates = false" "$SRC/WonderlandInstancedBatch.cpp"
check $? "batches are not replicated"

grep -q "BATCH_VISUALS" "$GEN"
check $? "the generator batches visual pieces"
grep -q "WONDERLAND_BATCH" "$GEN"
check $? "...with an escape hatch so batched and unbatched worlds can be compared"
grep -q "_wl_piece_hook(mesh_key, location, scale, label, rotation, mat)" "$GEN"
check $? "every piece passes through the analysis hook on every path"
grep -q "emit_batches()" "$GEN"
check $? "the batches are emitted before the map is saved"
python3 - "$GEN" <<'EMITORDER'
import io, sys
src = io.open(sys.argv[1], encoding="utf8").read()
emit = src.index("_batches_placed = emit_batches()")
save = src.index("SAVE EXPLICITLY to the target package")
# Emitting AFTER the save writes a world whose decoration never reached disk —
# the single failure mode of batching, and one that looks like an art bug.
sys.exit(0 if emit < save else 1)
EMITORDER
check $? "...and emitted BEFORE it, not after (or the decoration never reaches disk)"

# Neither harness may go back to splicing a recorder into a line of source: the
# line it used to target now sits inside a branch that batching does not take,
# and the injection would keep succeeding while recording nothing.
! grep -q "__wl_record__(mesh_key" "$HERE/../infra/build/verify-hero-composition.py"
check $? "the composition preview captures by hook, not by text injection"
! grep -q "__wl_record__(mesh_key" "$HERE/audit-draw-cost.py"
check $? "the draw-cost audit captures by hook, not by text injection"

# The budget must guard BOTH directions. An actor ceiling alone is satisfied by
# deleting half the world.
grep -q "LOOSE_FAIL_AT" "$DRY"; check $? "the dry run caps loose StaticMeshActors"
grep -q "PIECES_FLOOR" "$DRY"; check $? "...and floors the instanced piece count"
grep -q "reported no INSTANCED_PIECES at all" "$DRY"
check $? "...and fails when batching reported nothing rather than passing an empty world"

# The world proof cannot gate on actor count any more, or it fails the
# optimised world for being optimised.
grep -q "GExpectedMinPieces" "$SRC/WonderlandWorldProof.cpp"
check $? "the world proof gates on PIECES, not actors"
grep -q "VISIBLE_PIECES=" "$SRC/WonderlandWorldProof.cpp"
check $? "...and prints them so a live run can be read"
grep -q "DeclaredInstanceCount" "$SRC/WonderlandWorldProof.cpp"
check $? "...counting DECLARED instances (it runs before BeginPlay builds them)"

# The Marble backdrop hands the far distance to a generated shell. It must be
# OPT-IN: suppressing the skyline without the Marble layer actually placed
# leaves a hole where the horizon was.
grep -q "WONDERLAND_MARBLE_BACKDROP" "$GEN"
check $? "the Marble backdrop mode exists"
python3 - "$GEN" <<'BACKDROP'
import io, sys
src = io.open(sys.argv[1], encoding="utf8").read()
i = src.index('_MARBLE_BACKDROP = os.environ.get("WONDERLAND_MARBLE_BACKDROP"')
line = src[i:src.index("\n", i)]
problems = []
# Default must be OFF.
if '"0")' not in line:
    problems.append("does not default to off: %s" % line)
# The NEAREST ring must survive: Marble is a single-viewpoint shell that smears
# when a player walks, so the midground they move through stays authored.
if "_rings = _rings[:1]" not in src:
    problems.append("suppresses more than the far rings")
sys.exit(0 if not problems else (print(problems) or 1))
BACKDROP
check $? "...defaults to OFF and keeps the nearest ring authored"

# PROJECT PACKAGING SETTINGS LIVE IN DefaultGame.ini.
# UnrealEd.ProjectPackagingSettings is a GAME-ini config class. Declared in
# DefaultEngine.ini it parses cleanly and does nothing, so
# +DirectoriesToAlwaysCook never applied — and on a live L4 run every one of the
# 146 instanced batches logged "material did not load" and the world rendered
# grey. It survived before batching only because each StaticMeshActor held a
# hard material reference, which the cooker follows.
CFG="$HERE/../Config"
# The SECTION HEADER at line start, not the word. DefaultEngine.ini explains in
# a comment why the settings moved, and a bare word-grep read its own
# explanation as the offence — the fourth time in this session a check has
# fired on the prose describing why it should pass.
grep -qE '^\[/Script/UnrealEd\.ProjectPackagingSettings\]' "$CFG/DefaultGame.ini"
check $? "ProjectPackagingSettings is in DefaultGame.ini, where UE reads it"
! grep -qE '^\[/Script/UnrealEd\.ProjectPackagingSettings\]' "$CFG/DefaultEngine.ini"
check $? "...and NOT in DefaultEngine.ini, where it is silently ignored"
grep -q "DirectoriesToAlwaysCook" "$CFG/DefaultGame.ini"
check $? "the runtime-only asset directory is force-cooked"
# And the batch carries a HARD reference, so cooking does not depend on an ini
# being read from the right file at all.
grep -q "TObjectPtr<UMaterialInterface> Material" "$HERE/../Source/Wonderland/WonderlandInstancedBatch.h"
check $? "batches hold a hard material reference, not only a path string"
grep -q 'set_prop(actor, "Material", entry\["mat_obj"\])' "$GEN"
check $? "...and the generator wires the real material object into it"

# The world proof must not read BeginPlay state at actor-initialisation time.
PROOF="$HERE/../Source/Wonderland/WonderlandWorldProof.cpp"
grep -q "RUNTIME_RELAY_DOGS" "$PROOF"
check $? "the proof reports runtime dog facts separately, after BeginPlay"
! grep -q "Stroller->BuiltParts == 0" <(sed -n "1,/SECOND REPORT/p" "$PROOF")
check $? "...and no longer reads BuiltParts before BeginPlay has built anything"

# THE PALETTE MUST BE RE-APPLIED EVERY RUN.
# The MATERIAL_SPEC loop used to `continue` on an existing asset, and the
# content directory is persistent — so the first run's values were frozen and no
# later palette edit could reach the world. MI_stone, MI_rose, MI_gold and
# MI_spire all sat at BaseColor (1,1,1) on the live L4 and Wonderland streamed
# white. Same trap as new_level refusing to overwrite an existing .umap.
! grep -q 'mats\[name\] = eal.load_asset(ipath)' "$GEN"
check $? "the material loop no longer skips existing instances"
python3 - "$GEN" <<'PALETTE'
import io, sys
src = io.open(sys.argv[1], encoding="utf8").read()
# COMMENTS STRIPPED. The block explains that it "used to continue on an
# existing asset", and a bare search read its own explanation as the offence —
# the fifth time in this work a check has fired on the prose describing why it
# should pass. Strip first, then look at the code.
i = src.index('ipath = pkg + "/MI_" + name')
raw = src[i:i + 2600]
block = "\n".join(l.split("#")[0] for l in raw.splitlines())
problems = []
if "continue" in block.split("set_material_instance_parent")[0]:
    problems.append("still short-circuits before applying parameters")
# The parent and BaseColor must be set on BOTH paths, so they follow the if/else.
if block.index("set_material_instance_parent") > block.index("does_asset_exist") and    "else:" not in block.split("set_material_instance_parent")[0]:
    problems.append("no else branch — the existing-asset path skips the setters")
sys.exit(0 if not problems else (print(problems) or 1))
PALETTE
check $? "...and applies parent and parameters on both the new and existing paths"

# A TINT OVER NO TEXTURE IS WHITE. The texture pass sets BaseColor to a
# near-white tint because "the map carries the colour now" — which turns a
# coloured material white when the map is missing.
grep -q 'if texs.get("%s_a" % fam) is not None:' "$GEN"
check $? "the near-white tint is applied ONLY when an albedo map actually bound"
grep -q "TEXTURE MISSING for" "$GEN"
check $? "...and a missing map says so instead of silently whitening the surface"
# AND WHEN A MAP DOES BIND, the tint must MULTIPLY the palette rather than
# replace it. The generated maps are neutral detail — grain, crazing, veining —
# so a near-white tint over one throws the hue away. Measured live: MI_stone and
# MI_spire at (1,1,1) while MI_rose and MI_gold, whose maps were missing, were
# the only coloured things in the frame.
grep -q "_base\[0\] \* tint\[0\]" "$GEN"
check $? "a bound map MULTIPLIES the palette colour instead of replacing it"

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
good = {"coverage": {"objects_pct": 95.0, "sky_pct": 10.0, "bare_ground_pct": 0.1},
        "distinct_materials_visible": 40,
        "depth_pixels": {"near": 30.0, "mid": 50.0, "far": 10.0},
        "lone_primitive_pct": 0.5,
        "relay_dogs": {"readable": 5, "tallest_px": 150},
        # Every palette family a criterion reads must be here. When
        # warm_timber_stone was added as a criterion this fixture went stale and
        # the "passes everything" case started FAILING — which is the gate
        # working: an unmeasured criterion is not a pass.
        "palette_pct": {"cream_white": 20.0, "pink_rose_red": 14.0,
                        "violet_purple": 8.0, "gold_amber": 10.0,
                        "green_foliage": 18.0, "warm_timber_stone": 12.0}}
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

# The runtime world proof, captured from the SAME run the numbers came from.
# A Relay Dog count taken from a different run proves nothing about the frame
# that was measured.
BR="$TMP/bench"; mkdir -p "$BR"
cat > "$BR/app.log" <<'APPLOG'
LogWonderlandProof: Warning: WORLD=WonderlandHub
LogWonderlandProof: Warning: ACTORS=33028
LogWonderlandProof: Warning: RELAY_DOGS=9
LogWonderlandProof: Warning: COMPOUND_AGENTS=7
LogContentStreaming: Warning: Texture streaming pool over budget by 412.55 MB
APPLOG
printf '{"runs":[]}' > "$BR/report.json"
printf '{"fps_p50":58.0,"fps_min":54.0,"bitrate_kbps":4100.0,"resolution":"1280x720","freeze_count":0}' > "$BR/stats.json"
printf 'a,b,c,d,e,f\n2026,61 %%,22 %%,4100 MiB,55,1800\n2026,66 %%,24 %%,4180 MiB,56,1800\n' > "$BR/gpu.csv"
touch "$BR/shot.png"
WL_LOG_FILE="$BR/app.log" python3 "$HERE/bench-row.py" "$BR/report.json" 0 \
  "$BR/stats.json" "$BR/gpu.csv" "$BR/shot.png" 0 0 >/dev/null 2>&1
check $? "bench-row.py folds a run in"
python3 - "$BR/report.json" <<'CHECKROW'
import io, json, sys
run = json.load(io.open(sys.argv[1], encoding="utf8"))["runs"][0]
proof = (run.get("runtime") or {}).get("world_proof") or {}
problems = []
if proof.get("RELAY_DOGS") != "9":
    problems.append("RELAY_DOGS not captured: %r" % proof)
if proof.get("COMPOUND_AGENTS") != "7":
    problems.append("COMPOUND_AGENTS not captured: %r" % proof)
# NOTES ARE NOT STATUS. The first version appended notes to `status`, and the
# summary decides a run failed by testing status != "ok" — so a good run with a
# streaming warning was reported as having produced no measurement.
if run.get("status") != "ok":
    problems.append("a note corrupted status: %r" % run.get("status"))
if not run.get("notes"):
    problems.append("the streaming warning did not become a note")
sys.exit(0 if not problems else (print(problems) or 1))
CHECKROW
check $? "the runtime RELAY_DOGS / COMPOUND_AGENTS proof rides on the measured run"
WL_LOG_FILE="$BR/app.log" python3 "$HERE/bench-row.py" --summary "$BR/report.json" \
  > "$BR/sum.txt" 2>&1
grep -q "RUNTIME PROOF" "$BR/sum.txt"
check $? "the summary prints the runtime proof"
! grep -q "did NOT produce a measurement" "$BR/sum.txt"
check $? "a good run carrying a note is NOT counted as a failed run"
grep -q "TEXTURE STREAMING complained" "$BR/sum.txt"
check $? "texture streaming pressure is surfaced (a soft frame may be missing mips)"

sed -i 's/RELAY_DOGS=9/RELAY_DOGS=0/' "$BR/app.log"
printf '{"runs":[]}' > "$BR/report.json"
WL_LOG_FILE="$BR/app.log" python3 "$HERE/bench-row.py" "$BR/report.json" 0 \
  "$BR/stats.json" "$BR/gpu.csv" "$BR/shot.png" 0 0 > "$BR/zero.txt" 2>&1
grep -q "RELAY_DOGS=0" "$BR/zero.txt"
check $? "a run measuring a world with no Relay Dogs says so on the row"

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
