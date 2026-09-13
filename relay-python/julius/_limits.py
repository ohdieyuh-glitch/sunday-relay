"""Operating-system resource limits the runner applies to its own process.

Applied BEFORE the audit hook is installed and before any user code runs, and
reported by NAME, so an execution record says which mechanism actually held:

* Windows: a Job Object with a per-process memory limit and an active-process
  limit of 1 - the OS itself refuses a child process, whatever Python does.
* POSIX: ``RLIMIT_AS`` (address space), ``RLIMIT_CORE=0`` and ``RLIMIT_FSIZE``.

Anything a platform cannot enforce is reported as ``NONE``, never omitted.
"""

import os
import sys

_job = None


def _windows_job(memory_bytes):
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class BASIC(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class EXTENDED(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BASIC), ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    kernel32.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
    kernel32.QueryInformationJobObject.restype = wintypes.BOOL

    JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
    JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
    EXTENDED_LIMIT_INFORMATION = 9

    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return None, {"memory": "NONE", "processes": "NONE"}
    info = EXTENDED()
    flags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS
    info.BasicLimitInformation.ActiveProcessLimit = 1
    if memory_bytes is not None:
        flags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY
        info.ProcessMemoryLimit = int(memory_bytes)
    info.BasicLimitInformation.LimitFlags = flags
    if not kernel32.SetInformationJobObject(job, EXTENDED_LIMIT_INFORMATION, ctypes.byref(info), ctypes.sizeof(info)):
        return None, {"memory": "NONE", "processes": "NONE"}
    if not kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess()):
        return None, {"memory": "NONE", "processes": "NONE"}

    def peak():
        out = EXTENDED()
        if kernel32.QueryInformationJobObject(job, EXTENDED_LIMIT_INFORMATION, ctypes.byref(out), ctypes.sizeof(out), None):
            return int(out.PeakProcessMemoryUsed)
        return None

    return peak, {
        "memory": "WINDOWS_JOB_OBJECT" if memory_bytes is not None else "NONE",
        "processes": "WINDOWS_JOB_ACTIVE_PROCESS_LIMIT",
    }


def apply(limits):
    """Apply limits; return (peak_memory_reader_or_None, enforcement)."""
    global _job
    memory_bytes = limits.get("memoryBytes")
    if sys.platform == "win32":
        peak, enforcement = _windows_job(memory_bytes)
        _job = peak
        return peak, enforcement
    import resource

    enforcement = {"memory": "NONE", "processes": "PYTHON_AUDIT_HOOK"}
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        pass
    if memory_bytes is not None:
        try:
            resource.setrlimit(resource.RLIMIT_AS, (int(memory_bytes), int(memory_bytes)))
            enforcement["memory"] = "RLIMIT_AS"
        except (ValueError, OSError):
            enforcement["memory"] = "NONE"
    file_bytes = limits.get("maxArtifactBytes")
    if file_bytes is not None:
        try:
            resource.setrlimit(resource.RLIMIT_FSIZE, (int(file_bytes), int(file_bytes)))
            enforcement["fileSize"] = "RLIMIT_FSIZE"
        except (ValueError, OSError):
            enforcement["fileSize"] = "NONE"

    def peak():
        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux reports kilobytes, macOS bytes.
        return int(usage if sys.platform == "darwin" else usage * 1024)

    return peak, enforcement


def cpu_seconds():
    times = os.times()
    return round(times.user + times.system, 6)
