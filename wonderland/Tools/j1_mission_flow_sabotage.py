#!/usr/bin/env python3
"""Each mutation flips one mission-flow mapping. The KAT must then fail."""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
FLOW = "wonderland/Source/Wonderland/WonderlandJuliusMissionFlow.cpp"
NEEDED = [
    "wonderland/Tools/j1_mission_flow_kat.cpp",
    FLOW,
    "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp",
    "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.h",
    "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp",
    "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.h",
    "wonderland/Source/Wonderland/WonderlandJuliusMissionFlow.h",
]

MUTATIONS = [
    (
        "unknown_shown_finished",
        FLOW,
        "Out.bFinished = false; // FLOW_UNKNOWN_NOT_FINISHED",
        "Out.bFinished = true; // FLOW_UNKNOWN_NOT_FINISHED",
    ),
    (
        "expired_shown_succeeded",
        FLOW,
        "ProgressDisplayLabel(EMissionProgress::NotStarted); // FLOW_EXPIRED_SHOWS_NOT_STARTED",
        "ProgressDisplayLabel(EMissionProgress::Succeeded); // FLOW_EXPIRED_SHOWS_NOT_STARTED",
    ),
]


def main():
    cxx = os.environ.get("CXX", "g++")
    survived = []
    for name, rel, old, new in MUTATIONS:
        tmp = tempfile.mkdtemp(prefix="j1-flow-sab-")
        try:
            for needed in NEEDED:
                src = os.path.join(ROOT, needed)
                dst = os.path.join(tmp, needed)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
            path = os.path.join(tmp, rel)
            text = open(path, encoding="utf-8").read()
            count = text.count(old)
            if count != 1:
                print(f"SABOTAGE TARGET BROKEN {name}: found {count} times")
                return 2
            open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
            exe = os.path.join(tmp, "kat")
            build = subprocess.run(
                [
                    cxx, "-std=c++17", "-O0", "-w",
                    "-I", os.path.join(tmp, "wonderland/Source/Wonderland"),
                    os.path.join(tmp, "wonderland/Tools/j1_mission_flow_kat.cpp"),
                    os.path.join(tmp, FLOW),
                    os.path.join(tmp, "wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp"),
                    os.path.join(tmp, "wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp"),
                    "-o", exe,
                ],
                capture_output=True, text=True,
            )
            if build.returncode != 0:
                print(f"SABOTAGE {name}: does not compile\n{build.stderr[:400]}")
                return 2
            run = subprocess.run([exe], capture_output=True, text=True, timeout=60)
            if run.returncode == 0:
                survived.append(name)
                print(f"SABOTAGE SURVIVED {name}")
            else:
                print(f"SABOTAGE CAUGHT {name}")
        finally:
            shutil.rmtree(tmp)
    if survived:
        print(f"SABOTAGE RESULT FAIL survived={len(survived)}: {' '.join(survived)}")
        return 1
    print(f"SABOTAGE RESULT PASS caught={len(MUTATIONS)}/{len(MUTATIONS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
