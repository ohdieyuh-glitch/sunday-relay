# SECOND's window save (was committed over zc_gated_save.py in dc29f7ec by mistake; CORE's job is zc_gated_save_core.py).
# Globals: CONFIG = a json {"expect": {pass: batch count}, "replaced_passes": [...], "replaced_record": path or null,
#          "modified_record": path or null (packages an in-place edit job recorded, e.g. zc_cull_edit_in_place)}.
CONFIG = globals().get("CONFIG")
# Editor job: the ONE save of write window 1, behind a dirty-package gate.
# Saves only if every dirty package is one of these:
#   (a) the external package of an actor tagged with one of the window's 15 passes;
#   (b) a package recorded (zzW67) as belonging to a REPLACED pass before the re-apply (an expected deletion);
#   (c) an __ExternalObjects__ package (folders), listed by name;
#   (d) the map stub.
# It also requires every pass's actor count to equal its spec's batch count, and the guarded TR01 packages
# (Golden Arrival clock-plaza steps) to be untouched.
import ctypes
import json
import time

MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
S = "C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/3fac451f-d692-4e52-82cc-49dd0ba99485/scratchpad/"
CFG = json.load(open(CONFIG))
EXPECT = CFG["expect"]
REC = json.load(open(CFG["replaced_record"])) if CFG.get("replaced_record") else {}
REPLACED = set(p for k in CFG.get("replaced_passes", []) for p in REC.get(k, []))
GUARD = set(REC.get("TR01", []))
# (e) packages MODIFIED IN PLACE by a recorded edit job (the tree cull, zzW446): every one must be dirty, nothing else
MODIFIED = set(json.load(open(CFG["modified_record"]))) if CFG.get("modified_record") else set()
DO_SAVE = globals().get("DO_SAVE", True)
COMMIT_MAX_GB = globals().get("COMMIT_MAX_GB", 42.0)


# THE MEMORY GATE (founder rules 2026-09-29), CORE's probe from zc_gated_save_core.py verbatim: editor private GB,
# system commit GB and the dirty count are recorded in this job's result, and the save refuses above COMMIT_MAX_GB.
class _MEMSTAT(ctypes.Structure):
    _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]


class _PMC(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong), ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t), ("PrivateUsage", ctypes.c_size_t)]


def memory_gate():
    m = _MEMSTAT()
    m.dwLength = ctypes.sizeof(m)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
    commit = (m.ullTotalPageFile - m.ullAvailPageFile) / 1024.0 ** 3
    p = _PMC()
    p.cb = ctypes.sizeof(p)
    # 64-bit handles: without argtypes ctypes passes the pseudo-handle as a 32-bit int and the call fails silently
    # (window 2A's first run recorded editor_private_gb 0.0)
    k32 = ctypes.windll.kernel32
    k32.GetCurrentProcess.restype = ctypes.c_void_p
    k32.K32GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    k32.K32GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(p), p.cb)
    return round(commit, 1), round(p.PrivateUsage / 1024.0 ** 3, 1)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    dirty = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["dirty_before_count"] = len(dirty)
    commit, private = memory_gate()
    RESULT["memory_gate"] = {"system_commit_gb": commit, "editor_private_gb": private, "dirty_count": len(dirty),
                             "commit_max_gb": COMMIT_MAX_GB}
    if commit > COMMIT_MAX_GB:
        RESULT["status"] = "refused: system commit %.1f GB above the %.1f GB gate" % (commit, COMMIT_MAX_GB)
        RESULT["saved"] = False
        return
    counts = {k: 0 for k in EXPECT}
    pass_pkgs = set()
    guard_now = set()
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        tags = [str(t) for t in a.tags]
        if "WL_PASS_TR01" in tags:
            guard_now.add(a.get_outermost().get_name())
        for k in EXPECT:
            if "WL_PASS_" + k in tags:
                counts[k] += 1
                pass_pkgs.add(a.get_outermost().get_name())
    RESULT["pass_actor_counts"] = counts
    RESULT["count_mismatch"] = {k: (counts[k], EXPECT[k]) for k in EXPECT if counts[k] != EXPECT[k]}
    RESULT["guard_tr01_intact"] = (guard_now == GUARD) if GUARD else True
    cats = {"new_pass": 0, "replaced_deleted": 0, "modified": 0, "objects": [], "stub": [], "unexpected": []}
    for p in dirty:
        if p in GUARD:
            cats["unexpected"].append(p)
        elif p in pass_pkgs:
            cats["new_pass"] += 1
        elif p in REPLACED:
            cats["replaced_deleted"] += 1
        elif p in MODIFIED:
            cats["modified"] += 1
        elif "/__ExternalObjects__/" in p:
            cats["objects"].append(p)
        elif p == MAP:
            cats["stub"].append(p)
        else:
            cats["unexpected"].append(p)
    RESULT["dirty"] = cats
    ok = (not cats["unexpected"]) and not RESULT["count_mismatch"] and RESULT["guard_tr01_intact"] \
        and cats["new_pass"] == sum(EXPECT.values()) and cats["modified"] == len(MODIFIED)
    RESULT["gate_ok"] = ok
    if not ok:
        RESULT["status"] = "refused"
        RESULT["saved"] = False
        return
    if DO_SAVE:
        t0 = time.time()
        RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(world, MAP))
        RESULT["save_seconds"] = round(time.time() - t0, 1)
        yield 1.0
        RESULT["dirty_after"] = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
        RESULT["memory_after"] = dict(zip(("system_commit_gb", "editor_private_gb"), memory_gate()))
    RESULT["status"] = "done"
