"""THE PAID REVIEWER'S ISOLATION, OBSERVED ON THE PATH THE REVIEW TAKES.

Imported by Python at start-up, through PYTHONPATH, only when
`.github/julius-live-hermes.sh` runs its isolation proof, from a copy the
bootstrap places in a fresh directory and removes afterwards. That proof runs
the REAL wrapper, which runs the REAL `hermes -z` with the flags
`runHermesReview` passes, under the environment the reviewer child receives.
Without RELAY_REVIEWER_ISOLATION_RECORD in the environment this file installs
nothing. With it, it changes exactly two things about that run and nothing
else:

  1. Every name lookup and network connection raises. Nothing leaves the
     runner, so the proof cannot contact a provider or spend anything.
  2. The first `AIAgent.run_conversation` writes down what the agent was built
     with and returns a marker instead of asking a model anything.

Everything before that point is Hermes's own code: argument parsing,
`--safe-mode`, profile loading, toolset resolution, provider resolution and
agent construction. So the record says what a real review would have been
handed, not what a configuration file hoped it would be.

It RECORDS; it does not judge. `scripts/julius-reviewer-isolation.mjs verify`
decides whether the record is acceptable, where it can be tested.

Nothing here reads, prints or records a credential: the record holds toolset
and tool names, two timeouts, an attempt count, flags, and the targets of any
connection that was refused.
"""

import json
import os
import sys

_RECORD_PATH = os.environ.get("RELAY_REVIEWER_ISOLATION_RECORD", "")
_MARKER = "RELAY_REVIEWER_ISOLATION_PROOF_CAPTURED"
_OWNER_VARIABLE = "RELAY_REVIEWER_ISOLATION_OWNER"


def _write(path, record):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(record, handle, sort_keys=True)


def _install():
    import atexit
    import importlib.abc
    import importlib.machinery
    import socket

    refused = []
    state = {"captured": False}

    # ONE PROCESS OWNS THE RECORD. Hermes starts Python children of its own
    # (its environment probe runs `python3 -c` to read a version), and they
    # inherit PYTHONPATH, so they load this file too. The first process to load
    # it is the reviewer; a child gets the same closed network but writes only
    # a side record, and only if it was refused something, so it can never
    # overwrite what the reviewer was built with.
    owner = os.environ.get(_OWNER_VARIABLE)
    if owner is None:
        os.environ[_OWNER_VARIABLE] = str(os.getpid())
    is_owner = owner is None

    class _NetworkRefused(OSError):
        pass

    def _refuse(kind, target_index):
        def refuse(*args, **kwargs):
            target = args[target_index] if len(args) > target_index else kwargs.get("address")
            refused.append(f"{kind}:{target!r}"[:160])
            raise _NetworkRefused(f"relay reviewer isolation proof: the network is closed ({kind})")
        return refuse

    socket.getaddrinfo = _refuse("getaddrinfo", 0)
    socket.create_connection = _refuse("create_connection", 0)
    socket.socket.connect = _refuse("connect", 1)
    socket.socket.connect_ex = _refuse("connect_ex", 1)

    # THE GUARD PROVES ITSELF before anything else runs. A guard that silently
    # failed to install would let the proof reach the network and still pass.
    try:
        socket.create_connection(("127.0.0.1", 9), timeout=1)
        guard_verified = False
    except _NetworkRefused:
        guard_verified = True
    except Exception:  # noqa: BLE001 - any other outcome means the guard is not ours
        guard_verified = False
    refused.clear()

    def _sorted_names(values):
        return sorted(str(value) for value in (values or []))

    def _capture(self, user_message, *args, **kwargs):
        if state["captured"]:
            return {"final_response": _MARKER, "completed": True}
        record = {"reached": True, "network_guard_verified": guard_verified}
        try:
            tools = getattr(self, "tools", None) or []
            record["model_visible_tools"] = _sorted_names(
                (tool.get("function") or {}).get("name", "?") if isinstance(tool, dict) else "?"
                for tool in tools
            )
            record["valid_tool_names"] = _sorted_names(getattr(self, "valid_tool_names", None))
            enabled = getattr(self, "enabled_toolsets", None)
            record["agent_enabled_toolsets"] = None if enabled is None else _sorted_names(enabled)

            from hermes_cli.config import load_config
            from hermes_cli.tools_config import _get_platform_tools
            from hermes_cli.timeouts import get_provider_request_timeout, get_provider_stale_timeout

            record["resolved_cli_toolsets"] = _sorted_names(_get_platform_tools(load_config(), "cli"))
            record["provider"] = getattr(self, "provider", None)
            record["model"] = getattr(self, "model", None)
            record["request_timeout_seconds"] = get_provider_request_timeout(self.provider, self.model)
            record["stale_timeout_seconds"] = get_provider_stale_timeout(self.provider, self.model)
            # The stream watchdogs Hermes reads from its environment (loaded from
            # the profile .env) — as the agent will see them, or None if unset.
            for key, env_name in (
                ("codex_event_stale_timeout_seconds", "HERMES_CODEX_EVENT_STALE_TIMEOUT_SECONDS"),
                ("codex_ttfb_timeout_seconds", "HERMES_CODEX_TTFB_TIMEOUT_SECONDS"),
            ):
                raw = os.environ.get(env_name)
                try:
                    record[key] = None if raw is None else float(raw)
                except ValueError:
                    record[key] = None
            record["api_attempts"] = getattr(self, "_api_max_retries", None)
            record["max_iterations"] = getattr(self, "max_iterations", None)
            record["safe_mode"] = os.environ.get("HERMES_SAFE_MODE") == "1"
            try:
                from agent import shell_hooks

                record["shell_hooks_registered"] = len(shell_hooks._registered)
            except Exception:  # noqa: BLE001 - unknown is recorded as unknown
                record["shell_hooks_registered"] = None
            record["prompt_bytes"] = len(str(user_message).encode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - a partial record must say so
            record["capture_error"] = f"{type(exc).__name__}: {exc}"[:300]
        record["network_refused"] = list(refused)
        state["captured"] = True
        _write(_RECORD_PATH, record)
        return {"final_response": _MARKER, "completed": True}

    def _patch(module):
        agent_class = getattr(module, "AIAgent", None)
        if agent_class is not None:
            agent_class.run_conversation = _capture

    class _CaptureWhenImported(importlib.abc.MetaPathFinder):
        """Patches `run_agent` as it is imported, so nothing is imported early.

        Importing Hermes from here, before `main()` runs, would load modules
        before `--safe-mode` has set its environment, and the proof would
        observe a start-up order the real review never has.
        """

        def find_spec(self, fullname, path, target=None):
            if fullname != "run_agent":
                return None
            spec = importlib.machinery.PathFinder.find_spec(fullname, path)
            if spec is None or spec.loader is None:
                return spec
            execute = spec.loader.exec_module

            def exec_module(module):
                execute(module)
                _patch(module)

            spec.loader.exec_module = exec_module
            return spec

    def _child_exit():
        if refused:
            _write(f"{_RECORD_PATH}.child-{os.getpid()}", {"network_refused": list(refused)})

    if not is_owner:
        atexit.register(_child_exit)
        return

    sys.meta_path.insert(0, _CaptureWhenImported())

    def _never_reached():
        if not state["captured"]:
            _write(_RECORD_PATH, {
                "reached": False,
                "network_guard_verified": guard_verified,
                "network_refused": list(refused),
            })

    atexit.register(_never_reached)


if _RECORD_PATH:
    _install()
