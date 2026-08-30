#!/usr/bin/env python3
"""Execute build_v2.py against a stub engine. Syntax and control flow ONLY.

This proves the script does not crash, that every layout key has a recipe,
that every recipe builds, and that the phases run in order. It proves nothing
about what Unreal will do with any of it and it is never visual evidence. The
stub is V1's (engineering, migrated): `verify-generator-dryrun.make_unreal`.
"""
import importlib.util
import io
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(os.path.dirname(HERE), "infra", "build")
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BUILD, "hd"))

spec = importlib.util.spec_from_file_location("v1dry", os.path.join(BUILD, "verify-generator-dryrun.py"))
v1dry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v1dry)

warnings, errors = [], []
stub = v1dry.make_unreal()
stub.log_warning = lambda m: warnings.append(str(m))
stub.log_error = lambda m: errors.append(str(m))
stub.log = lambda m: None
# the stub has no Geometry Script; the build must take the FALLBACK and say so
sys.modules["unreal"] = stub
os.environ.setdefault("WLV2_MANIFEST", "/tmp/wlv2-dryrun-manifest.json")
# A FAST V2 texture set, so the import path, the sidecar and the tint/mean
# correction are exercised rather than skipped. WLV2_DRYRUN_TEXTURES=0 skips it.
if "WONDERLAND_TEXTURE_DIR" not in os.environ and os.environ.get("WLV2_DRYRUN_TEXTURES", "1") != "0":
    import subprocess
    import tempfile
    _td = os.path.join(tempfile.gettempdir(), "wlv2-dryrun-textures")
    if not os.path.exists(os.path.join(_td, "textures_v2.json")):
        subprocess.run([sys.executable, os.path.join(HERE, "textures_v2.py"), _td, "--fast"], check=True,
                       stdout=subprocess.DEVNULL)
    os.environ["WONDERLAND_TEXTURE_DIR"] = _td
os.environ.setdefault("WONDERLAND_TEXTURE_DIR", "/nonexistent")

src = io.open(os.path.join(HERE, "build_v2.py"), encoding="utf8").read()
ns = {"__name__": "__wl_v2_dryrun__", "__file__": os.path.join(HERE, "build_v2.py")}
exec(compile(src, "build_v2.py", "exec"), ns)

summary = [w for w in warnings if w.startswith("V2 SUMMARY")]
print("\n".join(w for w in warnings if w.startswith(("V2 PHASE", "V2 MAP", "V2 EMPTY", "V2 WORLD", "V2 DATA",
                                                    "V2 TEXTURES", "V2 MATERIAL", "V2 MESH", "GS CAP",
                                                    "V2 ASSETS", "V2 GROUND", "V2 COMPOSITION", "V2 LIGHT",
                                                    "V2 CAMERA", "V2 SUMMARY", "V2 MARBLE", "V2 SKY",
                                                    # PASS 08: "V2 CLOUDS" was missing from this whitelist,
                                                    # so every cloud line the generator has ever written --
                                                    # including the volumetric layer's own success and
                                                    # failure reports since PASS 06 -- was produced and then
                                                    # silently dropped from the gate's output. A gate that
                                                    # hides a subsystem cannot be used to check it.
                                                    "V2 CLOUDS", "V2 HLOD", "V2 PERFORMANCE", "V2 TEXTURES"))))
fails = [w for w in warnings if "FAILED" in w]
print("warnings: %d  failures: %d  errors: %d" % (len(warnings), len(fails), len(errors)))
for f in fails[:12]:
    print("  ! " + f[:160])
for e in errors[:6]:
    print("  ERROR " + e[:160])
if not summary or errors or fails:
    print("DRY RUN: FAIL")
    sys.exit(1)
print("DRY RUN: PASS (control flow only; no visual claim)")
