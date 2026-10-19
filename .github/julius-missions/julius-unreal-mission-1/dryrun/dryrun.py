"""THE DRY RUN of julius-unreal-mission-1 (row 14-Unreal, C1). It runs the mission's declared test, exactly as the contract's
testCommand runs it, against:
  1. the SEED (the workspace as pinned): it must be RED, and ONLY because the six QA declarations are missing (check (a));
  2. the REFERENCE FIX (dryrun/reference/, never in the workspace): it must be GREEN, all five checks;
  3. each MUTANT of the reference fix: the named check must turn RED (SECOND's S2 m1-m5, plus MAIN's m6-m12).
Usage: dryrun.py <workspace dir> <reference dir> <scratch dir for the copies>
Exit 0 only when every expectation holds. Nothing outside the scratch dir is written."""
import os
import re
import shutil
import subprocess
import sys

workspace, reference, scratch = sys.argv[1], sys.argv[2], sys.argv[3]
sys.stdout.reconfigure(encoding='utf-8')
D = os.path.join('wonderland', 'Source', 'Wonderland')
CPP = os.path.join(D, 'WonderlandSocialHubPanel.cpp')
H = os.path.join(D, 'WonderlandSocialHubPanel.h')
TEST = ['node', '--test', '.julius/hub-scroll-static.test.mjs']
os.makedirs(scratch, exist_ok=False)


def run(ws):
    out = subprocess.run(TEST, cwd=ws, capture_output=True, text=True, encoding='utf-8')
    failed = sorted(set(re.findall(r'^not ok \d+ - \(([a-e])\)', out.stdout, re.M)))
    passed = sorted(set(re.findall(r'^ok \d+ - \(([a-e])\)', out.stdout, re.M)))
    return out.returncode, failed, passed


def copy(name, with_reference):
    ws = os.path.join(scratch, name)
    shutil.copytree(workspace, ws, ignore=shutil.ignore_patterns('.git'))
    if with_reference:
        for rel in (CPP, H):
            shutil.copyfile(os.path.join(reference, os.path.basename(rel)), os.path.join(ws, rel))
    return ws


def edit(ws, rel, old, new):
    path = os.path.join(ws, rel)
    text = open(path, encoding='utf-8', newline='').read()
    assert text.count(old) == 1, (rel, old[:60], text.count(old))
    open(path, 'w', encoding='utf-8', newline='').write(text.replace(old, new))


MUTANTS = [
    ('m1', 'a read-only header edited', 'b',
     lambda ws: open(os.path.join(ws, D, 'WonderlandSocialTypes.h'), 'a', encoding='utf-8', newline='').write('// m1\n')),
    ('m2', "SetSnapshot rebuilds at once (F-21 removed)", 'c',
     lambda ws: edit(ws, CPP, '\tRequestRebuild();   // F-21: never at once from a refresh (FlushRebuild says why)\n',
                     '\tRebuild();   // F-21: never at once from a refresh (FlushRebuild says why)\n')),
    ('m3', 'one byte changed in the HUBCLICK QA region', 'd',
     lambda ws: edit(ws, CPP, 'HubClickCheck(ClickRun, TEXT("HC5")', 'HubClickCheck(ClickRun, TEXT("HC6")')),
    ('m4', 'a non-allow-listed #include added', 'e',
     lambda ws: edit(ws, CPP, '#include "Misc/DateTime.h"\n', '#include "Misc/DateTime.h"\n#include "Misc/Paths.h"\n')),
    ('m5', 'one of the six declarations renamed', 'a',
     lambda ws: edit(ws, H, '\tbool QaHistoryAtEnd() const;\n', '\tbool QaHistoryIsAtEnd() const;\n')),
    ('m6', 'the read-only QA spec edited', 'b',
     lambda ws: open(os.path.join(ws, D, 'WonderlandSocialHubScrollQa.cpp'), 'a', encoding='utf-8', newline='').write('// m6\n')),
    ('m7', 'a file added under wonderland/', 'b',
     lambda ws: open(os.path.join(ws, D, 'WonderlandSocialHubScrollMemory.h'), 'w', encoding='utf-8', newline='').write('#pragma once\n')),
    ('m8', 'a closing brace removed', 'e',
     lambda ws: edit(ws, CPP, '\tbScrollMemoryOn = bOn;\n}\n', '\tbScrollMemoryOn = bOn;\n')),
    ('m9', 'a declaration moved out of the public section', 'a',
     lambda ws: (edit(ws, H, '\tvoid QaSetScrollMemory(bool bOn);\n', ''),
                 edit(ws, H, '\tbool bScrollMemoryOn = true;\n', '\tbool bScrollMemoryOn = true;\n\tvoid QaSetScrollMemory(bool bOn);\n'))),
    ('m10', "the pre-tick no longer checks for a pending rebuild", 'c',
     lambda ws: edit(ws, CPP, 'void SWonderlandSocialHubPanel::HandleSlatePreTick(float DeltaTime)\n{\n\tif (bRebuildPending)\n\t{\n\t\tRebuild();\n\t}\n}',
                     'void SWonderlandSocialHubPanel::HandleSlatePreTick(float DeltaTime)\n{\n\tRebuild();\n}')),
    ('m11', 'SetVoice rebuilds at once', 'c',
     lambda ws: edit(ws, CPP, '\t\tRequestRebuild();   // F-21: every talking on/off lands here; a rebuild at once could eat MUTE MIC\n',
                     '\t\tRebuild();   // F-21: every talking on/off lands here; a rebuild at once could eat MUTE MIC\n')),
    ('m12', "the sixth hook's definition renamed", 'a',
     lambda ws: edit(ws, CPP, 'void SWonderlandSocialHubPanel::QaSetScrollMemory(bool bOn)\n', 'void SWonderlandSocialHubPanel::QaSetScrollMemoryOn(bool bOn)\n')),
]

ok = True
rc, failed, passed = run(copy('seed', False))
seed_ok = rc != 0 and failed == ['a'] and passed == ['b', 'c', 'd', 'e']
ok &= seed_ok
print(f"SEED      exit {rc} failed {failed} passed {passed} -> {'RED for (a) only: as required' if seed_ok else 'UNEXPECTED'}")
rc, failed, passed = run(copy('reference', True))
ref_ok = rc == 0 and failed == [] and passed == ['a', 'b', 'c', 'd', 'e']
ok &= ref_ok
print(f"REFERENCE exit {rc} failed {failed} passed {passed} -> {'GREEN: as required' if ref_ok else 'UNEXPECTED'}")
for mid, what, want, mutate in MUTANTS:
    ws = copy(mid, True)
    mutate(ws)
    rc, failed, passed = run(ws)
    killed = rc != 0 and want in failed
    ok &= killed
    print(f"{mid:<4} ({want}) {'KILLED' if killed else 'SURVIVED'}: exit {rc}, failed {failed} -- {what}")
print('DRY RUN', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
