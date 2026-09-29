# THE GATED SAVE (CORE's): save the map only if every dirty package belongs to this window's transaction.
# (Kept under this name on 2026-09-29 14:25 when SECOND's CONFIG-driven zc_gated_save.py replaced the shared file in
# dc29f7ec; that version has no memory gate. CORE's windows use this one: PASSES / BATCH_LABELS / COMMIT_MAX_GB.)
#
# Founder rules 2026-09-29: bounded windows, ONE save per editor session, a MEMORY GATE recorded before every save.
# This job is that save. Before writing it records: editor private GB, system commit GB, the dirty-package count;
# refuses above COMMIT_MAX_GB. Every dirty package must be one of:
#   * an __ExternalActors__ package whose actor carries a WL_PASS_<id> tag with <id> in PASSES;
#   * an __ExternalActors__ package whose actor label is in BATCH_LABELS (edited-in-place batches, e.g. hedges);
#   * an __ExternalObjects__ package (actor folders the applies create);
#   * the map package itself (the stub).
# Anything else -- another lane's unsaved edit, an accidental change -- refuses the save and lists it.
# Set before queueing: PASSES (list of pass ids), BATCH_LABELS (list), COMMIT_MAX_GB.
CONCURRENT = False

import ctypes
import os

PASSES = set(globals().get("PASSES", []))
BATCH_LABELS = set(globals().get("BATCH_LABELS", []))
COMMIT_MAX_GB = globals().get("COMMIT_MAX_GB", 42.0)
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"


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
    RESULT["status"] = "running"
    commit, private = memory_gate()
    dirty = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["memory_gate"] = {"system_commit_gb": commit, "editor_private_gb": private, "dirty_count": len(dirty),
                             "commit_max_gb": COMMIT_MAX_GB}
    if commit > COMMIT_MAX_GB:
        RESULT["status"] = "refused: system commit %.1f GB above the %.1f GB gate" % (commit, COMMIT_MAX_GB)
        return
    # which actor owns each external package
    owner = {}
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for a in eas.get_all_level_actors():
        try:
            pkg = a.get_outermost().get_name()
        except Exception:
            continue
        owner[pkg] = a
        if len(owner) % 2000 == 0:
            yield 0.0          # ONE tick per 2,000 actors: a yield per actor took 21 min at 3-31 ticks/s (window 2A)
    matched, objects, stub, unexpected = {}, 0, 0, []
    for name in dirty:
        if name == MAP:
            stub += 1
            continue
        if "/__ExternalObjects__/" in name:
            objects += 1
            continue
        a = owner.get(name)
        if a is None:
            unexpected.append(name + " (no actor)")
            continue
        tags = [str(t) for t in a.tags]
        pid = next((t[8:] for t in tags if t.startswith("WL_PASS_") and t[8:] in PASSES), None)
        label = a.get_actor_label()
        if pid:
            matched[pid] = matched.get(pid, 0) + 1
        elif label in BATCH_LABELS:
            matched["batch:" + label] = matched.get("batch:" + label, 0) + 1
        else:
            unexpected.append("%s (%s; tags %s)" % (name, label, tags[:4]))
    RESULT["dirty_matched"] = matched
    RESULT["dirty_external_objects"] = objects
    RESULT["dirty_stub"] = stub
    RESULT["dirty_unexpected"] = unexpected[:40]
    if unexpected:
        RESULT["status"] = "refused: %d dirty package(s) outside the transaction" % len(unexpected)
        RESULT["saved"] = False
        return
    RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(ues.get_editor_world(), MAP))
    RESULT["dirty_after"] = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["memory_after"] = dict(zip(("system_commit_gb", "editor_private_gb"), memory_gate()))
    RESULT["status"] = "saved" if RESULT["saved"] else "save_map returned False"
