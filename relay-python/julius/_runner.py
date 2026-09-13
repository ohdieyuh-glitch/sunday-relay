"""The bootstrap Julius runs in place of a user's script.

    python -s -P -B -X utf8 <sdk>/julius/_runner.py <control.json>

In order: verify the script is the one Julius hashed; apply OS limits; open the
session; verify the declared dependency pins; install the audit hook; run the
script as ``__main__``; then - whatever happened - write the structured result,
the staged proposals and a usage report. The process exit code is the script's.

Everything written here is REPORTED BY THE RUNNER inside the execution. Julius
treats it accordingly: wall time, exit status, stream hashes and artifact
hashes are observed by the host, never taken from this file.
"""

import hashlib
import json
import os
import platform
import runpy
import sys
import time
import traceback

USAGE_FORMAT = "julius-python-usage.v1"
EXIT_CONTROL_INVALID = 90
EXIT_SCRIPT_HASH_MISMATCH = 91
EXIT_DEPENDENCY_UNSATISFIED = 92


def _write_json(path, value):
    temp = "%s.%d.tmp" % (path, os.getpid())
    with open(temp, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, sort_keys=True, allow_nan=False)
    os.replace(temp, path)


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def _distributions_for(module_names):
    """The installed distributions behind the modules this execution imported."""
    try:
        from importlib import metadata
        mapping = metadata.packages_distributions()
    except Exception:  # noqa: BLE001 - reported as unknown, never guessed
        return None
    found = {}
    for name in module_names:
        for dist in mapping.get(name, ()):
            try:
                found[dist] = metadata.version(dist)
            except Exception:  # noqa: BLE001
                found[dist] = None
    return [{"name": name, "version": version} for name, version in sorted(found.items())]


EXIT_HOST_GONE = 96


def _watch_parent():
    """End this execution when the host that started it dies.

    A host that crashed can never settle this execution, so continuing would
    only spend resources on output nobody can admit. Everything needed is
    resolved here, before the audit hook is armed, so the watch itself never
    asks the hook for permission.
    """
    import threading

    parent = os.getppid()
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        open_process = kernel32.OpenProcess
        open_process.restype = wintypes.HANDLE
        open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        wait = kernel32.WaitForSingleObject
        wait.restype = wintypes.DWORD
        wait.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        synchronize = 0x00100000
        handle = open_process(synchronize, False, parent)
        if not handle:
            return "NONE"

        def watch():
            wait(handle, 0xFFFFFFFF)
            os._exit(EXIT_HOST_GONE)
    else:
        def watch():
            import time as _time
            while os.getppid() == parent:
                _time.sleep(0.5)
            os._exit(EXIT_HOST_GONE)

    threading.Thread(target=watch, name="julius-host-watch", daemon=True).start()
    return "PARENT_WATCH"


def _unsatisfied(requirements):
    from importlib import metadata
    missing = []
    for requirement in requirements:
        try:
            installed = metadata.version(requirement["name"])
        except metadata.PackageNotFoundError:
            installed = None
        if installed != requirement["version"]:
            missing.append({"name": requirement["name"], "required": requirement["version"], "installed": installed})
    return missing


def main(argv):
    started = time.perf_counter()
    try:
        with open(argv[1], "r", encoding="utf-8") as handle:
            control = json.load(handle)
        usage_path = control["usagePath"]
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return EXIT_CONTROL_INVALID

    usage = {
        "format": USAGE_FORMAT,
        "executionId": control.get("executionId"),
        "interpreter": {
            "version": platform.python_version(),
            "implementation": platform.python_implementation(),
            "platform": platform.platform(),
        },
        "enforcement": {},
        "denials": [],
        "denialCount": 0,
        "scriptError": None,
        "structuredOutputError": None,
        "dependencies": None,
        "unsatisfiedRequirements": [],
        "peakMemoryBytes": None,
        "cpuSeconds": None,
        "runnerSeconds": None,
    }

    if _sha256_file(control["scriptPath"]) != control["scriptHash"]:
        usage["scriptError"] = "ScriptHashMismatch"
        _write_json(usage_path, usage)
        return EXIT_SCRIPT_HASH_MISMATCH

    sdk_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if sdk_root not in sys.path:
        sys.path.insert(0, sdk_root)
    from julius import _guard, _limits, _session  # noqa: E402 - after the path is set

    peak_reader, enforcement = _limits.apply(control["limits"])
    usage["enforcement"].update(enforcement)
    usage["enforcement"]["hostLiveness"] = _watch_parent()

    unsatisfied = _unsatisfied(control.get("requirements", []))
    if unsatisfied:
        usage["unsatisfiedRequirements"] = unsatisfied
        _write_json(usage_path, usage)
        return EXIT_DEPENDENCY_UNSATISFIED

    _session.configure(control)
    baseline_modules = set(sys.modules)
    guard = _guard.install(control, sdk_root)
    usage["enforcement"].update(guard.enforcement())

    exit_code = 0
    sys.argv = [control["scriptPath"]] + list(control.get("argv", []))
    try:
        os.chdir(control["workDir"])
        runpy.run_path(control["scriptPath"], run_name="__main__")
    except SystemExit as stop:
        code = stop.code
        exit_code = code if isinstance(code, int) else (0 if code is None else 1)
    except BaseException as error:  # noqa: BLE001 - every failure is reported, then the exit code says so
        traceback.print_exc()
        usage["scriptError"] = type(error).__name__
        exit_code = 1
    finally:
        guard.flushing = True
        try:
            _session.flush()
        except BaseException as error:  # noqa: BLE001
            traceback.print_exc()
            usage["structuredOutputError"] = type(error).__name__
            if exit_code == 0:
                exit_code = 1
        imported = sorted({name.split(".")[0] for name in set(sys.modules) - baseline_modules})
        usage["dependencies"] = _distributions_for(imported)
        usage["denials"] = guard.denials
        usage["denialCount"] = guard.denial_count
        usage["peakMemoryBytes"] = peak_reader() if peak_reader is not None else None
        usage["cpuSeconds"] = _limits.cpu_seconds()
        usage["runnerSeconds"] = round(time.perf_counter() - started, 6)
        try:
            _write_json(usage_path, usage)
        except BaseException:  # noqa: BLE001
            traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
    return exit_code


if __name__ == "__main__":
    # os._exit: a script's non-daemon threads and atexit handlers must not keep
    # a finished execution alive past the point its result was written.
    os._exit(main(sys.argv))
