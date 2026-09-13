"""The execution's audit hook: network, process, native-library and file governance.

``sys.addaudithook`` installs a hook that cannot be removed for the life of the
interpreter. The runner installs this one after it has set everything up and
immediately before the user script starts.

WHAT THIS IS, PRECISELY. Governance of cooperative and buggy code: an
accidental ``requests.get``, a ``subprocess.run``, a write to the wrong
directory, a read of a file nobody granted - each raises ``PermissionError``
with a stable reason and is counted. It is NOT a security boundary against
code written to escape it: native extensions and memory-level tricks can
bypass an in-process hook. Julius records the mechanism as
``PYTHON_AUDIT_HOOK`` for exactly that reason; OS-level isolation (a container
with no network, a read-only root) is what a hostile workload requires, and is
reported as such when it is present.
"""

import os
import sys
import threading

_WRITE_FLAGS = (
    os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC | getattr(os, "O_EXCL", 0)
)

_PROCESS_EVENTS = frozenset({
    "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork",
    "os.forkpty", "os.startfile", "pty.spawn", "os.kill", "os.killpg",
})
_NATIVE_EVENTS = frozenset({"ctypes.dlopen", "ctypes.dlsym", "ctypes.dlsym/handle"})
_NETWORK_ADDRESS_EVENTS = frozenset({"socket.connect", "socket.bind", "socket.sendto", "socket.sendmsg"})
_NAME_EVENTS = frozenset({
    "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyname_ex", "socket.gethostbyaddr",
    "socket.getnameinfo",
})
_WRITE_PATH_EVENTS = {
    "os.remove": (0,), "os.rmdir": (0,), "os.mkdir": (0,), "os.chmod": (0,), "os.chown": (0,),
    "os.truncate": (0,), "os.utime": (0,), "os.rename": (0, 1), "os.link": (0, 1), "os.symlink": (1,),
    "shutil.copyfile": (1,), "shutil.copymode": (1,), "shutil.copystat": (1,), "shutil.copytree": (1,),
    "shutil.move": (0, 1), "shutil.rmtree": (0,), "shutil.chown": (0,), "shutil.unpack_archive": (1,),
}
_READ_PATH_EVENTS = {"os.listdir": (0,), "os.scandir": (0,), "glob.glob": (0,)}
_DEVICE_READS = frozenset({"/dev/null", "/dev/urandom", "/dev/random", "nul"})
MAX_RECORDED_DENIALS = 50


def _normal(path):
    try:
        if isinstance(path, int):
            return None
        return os.path.normcase(os.path.realpath(os.fsdecode(path)))
    except Exception:  # noqa: BLE001 - an unresolvable path is treated as outside every root
        return "\x00unresolvable"


def _inside(path, roots):
    return any(path == root or path.startswith(root.rstrip(os.sep) + os.sep) for root in roots)


class Guard:
    def __init__(self, control, sdk_root):
        policy = control["network"]
        self.network_mode = policy["mode"]
        self.allowed_hosts = frozenset(d["host"].lower() for d in policy.get("destinations", ()))
        self.allowed_endpoints = frozenset()
        self.write_roots = [_normal(p) for p in control["writeRoots"]]
        self.protected_roots = [_normal(control["controlDir"])]
        system_roots = {sys.prefix, sys.base_prefix, sys.exec_prefix, sys.base_exec_prefix, os.path.dirname(os.__file__), sdk_root}
        try:
            import site
            system_roots.update(site.getsitepackages())
        except Exception:  # noqa: BLE001 - a venv without getsitepackages still has sys.prefix
            pass
        self.read_roots = [_normal(p) for p in list(control["readRoots"]) + [p for p in system_roots if p]] + self.write_roots
        self.denials = []
        self.denial_count = 0
        self.flushing = False
        self._local = threading.local()

    def resolve_allowlist(self):
        """Resolve allowlisted hosts BEFORE the hook is armed; connect is then checked by address."""
        if self.network_mode != "ALLOWLIST":
            return
        import socket
        endpoints = set()
        for host in self.allowed_hosts:
            try:
                for info in socket.getaddrinfo(host, None):
                    endpoints.add(info[4][0])
            except OSError:
                pass
        self.allowed_endpoints = frozenset(endpoints)

    def _deny(self, event, detail):
        self.denial_count += 1
        if len(self.denials) < MAX_RECORDED_DENIALS:
            self.denials.append({"event": event, "detail": str(detail)[:300]})
        raise PermissionError("julius_python_denied:%s:%s" % (event, detail))

    def _check_write(self, event, raw):
        path = _normal(raw)
        if path is None:
            return
        if _inside(path, self.protected_roots) and not self.flushing:
            self._deny(event, "the execution control directory is not writable")
        if path.replace("\\", "/") in _DEVICE_READS:
            return
        if not _inside(path, self.write_roots + (self.protected_roots if self.flushing else [])):
            self._deny(event, "write outside the granted directories")

    def _check_read(self, event, raw):
        path = _normal(raw)
        if path is None:
            return
        if path.replace("\\", "/") in _DEVICE_READS:
            return
        if not _inside(path, self.read_roots):
            self._deny(event, "read outside the granted directories")

    def hook(self, event, args):
        if getattr(self._local, "busy", False):
            return
        self._local.busy = True
        try:
            if event == "open":
                raw, mode, flags = (tuple(args) + (None, None, None))[:3]
                writing = (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
                    isinstance(flags, int) and bool(flags & _WRITE_FLAGS))
                (self._check_write if writing else self._check_read)(event, raw)
            elif event in _WRITE_PATH_EVENTS:
                for index in _WRITE_PATH_EVENTS[event]:
                    if index < len(args):
                        self._check_write(event, args[index])
            elif event in _READ_PATH_EVENTS:
                for index in _READ_PATH_EVENTS[event]:
                    if index < len(args) and args[index] is not None:
                        self._check_read(event, args[index])
            elif event in _PROCESS_EVENTS:
                if event in ("os.kill", "os.killpg") and len(args) > 0 and args[0] == os.getpid():
                    return
                self._deny(event, "process creation and signalling are denied")
            elif event in _NATIVE_EVENTS:
                self._deny(event, "loading native libraries through ctypes is denied")
            elif event in _NAME_EVENTS:
                host = str(args[0]).lower() if args else ""
                if self.network_mode != "ALLOWLIST" or host not in self.allowed_hosts:
                    self._deny(event, "name resolution is denied (%s)" % host)
            elif event in _NETWORK_ADDRESS_EVENTS:
                address = args[1] if len(args) > 1 else None
                host = address[0] if isinstance(address, tuple) and address else address
                if self.network_mode != "ALLOWLIST" or str(host) not in self.allowed_endpoints:
                    self._deny(event, "network access is denied (%s)" % (host,))
        finally:
            self._local.busy = False

    def enforcement(self):
        return {
            "network": "PYTHON_AUDIT_HOOK_DENY" if self.network_mode == "DENY" else "PYTHON_AUDIT_HOOK_ALLOWLIST",
            "filesystem": "PYTHON_AUDIT_HOOK",
            "nativeLibraries": "PYTHON_AUDIT_HOOK",
        }


def install(control, sdk_root):
    guard = Guard(control, sdk_root)
    guard.resolve_allowlist()
    sys.addaudithook(guard.hook)
    return guard
