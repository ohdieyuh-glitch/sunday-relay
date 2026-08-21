#!/usr/bin/env python3
"""Resolve a rendering profile into launch arguments — and refuse unverified ones.

    render-profile.py emit    BALANCED     # the -ExecCmds payload
    render-profile.py args    BALANCED     # the command-line switches
    render-profile.py show    BALANCED     # every setting with its source
    render-profile.py check                # gate: do the profiles only name real CVars?

THE POINT OF THE GATE

Unreal does not fail on a console variable it has never heard of, and it does
not fail on an unknown command-line switch either. A rendering profile is
therefore the easiest kind of change to *believe* you shipped: the stream comes
up, the settings do nothing, and the conclusion recorded is "TSR made no
difference" when TSR was never enabled.

So a name only leaves this file if the ENGINE has been asked about it.
`probe-cvars.sh` writes engine-cvars.5.8.json from a real launch; this refuses
to emit anything that probe marked absent. With no probe file it still emits —
otherwise the first probe could never be run — but it says loudly, on stderr,
that nothing has been verified. `--strict` turns that into a refusal, which is
what the bench uses so a measurement can never be attributed to a setting that
was silently ignored.
"""
import argparse
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILES = os.path.join(HERE, "profiles.json")
PROBE = os.path.join(HERE, "engine-cvars.5.8.json")


def load_profiles():
    with io.open(PROFILES, encoding="utf8") as handle:
        return json.load(handle)


def load_probe():
    if not os.path.exists(PROBE):
        return None
    with io.open(PROBE, encoding="utf8") as handle:
        return json.load(handle)


def pick(data, name):
    profiles = data["profiles"]
    if name not in profiles:
        sys.stderr.write("no such profile %r. Have: %s\n"
                         % (name, ", ".join(sorted(profiles))))
        raise SystemExit(2)
    return profiles[name]


def gate(names, strict, where):
    """Return the names that may be emitted, refusing or warning as appropriate."""
    probe = load_probe()
    if probe is None:
        message = (
            "UNPROBED: no %s, so not one of these %d console variables has been\n"
            "  confirmed to exist in this engine build. Unreal ignores unknown\n"
            "  CVars silently, so any measurement taken now may be measuring\n"
            "  nothing. Run wonderland/rendering/probe-cvars.sh on the GPU box.\n"
            % (os.path.basename(PROBE), len(names)))
        if strict:
            sys.stderr.write("REFUSED (%s): " % where + message)
            raise SystemExit(2)
        sys.stderr.write("WARNING (%s): " % where + message)
        return list(names), []

    verdicts = probe.get("verdicts", {})
    # A PROBE THAT MEASURED NOTHING IS NOT A PROBE. If the build hung or died
    # before it reached a console, every name comes back `silent` — and silent
    # names are filtered out of the payload rather than refused, so --strict
    # would have emitted an EMPTY -ExecCmds and reported success. The bench
    # would then have measured the engine's defaults under a profile's name.
    # Found by pointing the probe at a process that just sleeps.
    if probe.get("warning") or (verdicts and
                                all(v == "silent" for v in verdicts.values())):
        message = ("the probe file at %s answered for NOTHING (%s). It did not "
                   "measure this engine — the build most likely never reached a "
                   "console. Re-run probe-cvars.sh and check its log before "
                   "trusting any verdict.\n"
                   % (os.path.basename(PROBE),
                      probe.get("warning", "every name is silent")))
        if strict:
            sys.stderr.write("REFUSED (%s): " % where + message)
            raise SystemExit(2)
        sys.stderr.write("WARNING (%s): " % where + message)
    absent = [n for n in names if verdicts.get(n) == "absent"]
    silent = [n for n in names if verdicts.get(n) in (None, "silent")]
    if absent:
        sys.stderr.write(
            "REFUSED (%s): this engine does not have %d of the console variables "
            "the profile names:\n" % (where, len(absent)))
        for name in absent:
            sys.stderr.write("  - %s\n" % name)
        sys.stderr.write("Fix profiles.json or re-probe. Shipping these would be "
                         "a setting that silently does nothing.\n")
        raise SystemExit(2)
    if silent:
        sys.stderr.write(
            "NOTE (%s): the engine answered for neither of these — treat any "
            "result from them as unproven:\n  %s\n" % (where, ", ".join(silent)))
    return [n for n in names if n not in silent], silent


def format_value(value):
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float):
        # 2.0 -> "2.0" keeps float CVars unambiguous; 200.0 -> "200"
        return ("%g" % value) if value != int(value) else str(int(value))
    return str(value)


def cmd_emit(args):
    data = load_profiles()
    profile = pick(data, args.profile)
    names = list(profile["cvars"].keys())
    allowed, _silent = gate(names, args.strict, "emit %s" % args.profile)
    parts = ["%s %s" % (n, format_value(profile["cvars"][n]["value"])) for n in allowed]
    sys.stdout.write(",".join(parts))
    return 0


def cmd_args(args):
    data = load_profiles()
    profile = pick(data, args.profile)
    sys.stdout.write(" ".join(profile.get("args", [])))
    return 0


def cmd_show(args):
    data = load_profiles()
    profile = pick(data, args.profile)
    probe = load_probe()
    verdicts = (probe or {}).get("verdicts", {})
    print("%s — %s\n" % (args.profile, profile["description"]))
    print("%-46s %-8s %-9s %s" % ("cvar", "value", "engine", "source"))
    for name, entry in profile["cvars"].items():
        print("%-46s %-8s %-9s %s" % (
            name, format_value(entry["value"]),
            verdicts.get(name, "unprobed"), entry.get("source", "")))
    print("\ncommand-line arguments:")
    for arg in profile.get("args", []):
        print("  %s" % arg)
    if probe is None:
        print("\nNo probe file. Nothing above is confirmed to exist in the engine.")
    return 0


def cmd_check(args):
    data = load_profiles()
    problems = []
    for name, profile in data["profiles"].items():
        for key, entry in profile["cvars"].items():
            if "value" not in entry:
                problems.append("%s: %s has no value" % (name, key))
            if not entry.get("source"):
                problems.append("%s: %s has no source" % (name, key))
        for arg in profile.get("args", []):
            if not arg.startswith("-"):
                problems.append("%s: argument %r does not start with '-'" % (name, arg))
    # A rejected name must never also appear in a profile: that is the exact
    # mistake the rejection list exists to prevent, and it is silent.
    rejected = set(data.get("rejected", {}))
    for name, profile in data["profiles"].items():
        for key in profile["cvars"]:
            if key in rejected:
                problems.append("%s applies %s, which this file also REJECTS"
                                % (name, key))
    if data.get("default") not in data["profiles"]:
        problems.append("default profile %r does not exist" % data.get("default"))

    probe = load_probe()
    if probe:
        verdicts = probe.get("verdicts", {})
        for name, profile in data["profiles"].items():
            for key in profile["cvars"]:
                if verdicts.get(key) == "absent":
                    problems.append("%s applies %s, which this engine does not have"
                                    % (name, key))
    if problems:
        print("FAIL %d problem(s):" % len(problems))
        for problem in problems:
            print("  - %s" % problem)
        return 1
    print("OK   %d profiles, %d candidates, %d rejected settings"
          % (len(data["profiles"]), len(data.get("candidates", [])),
             len(data.get("rejected", {}))))
    print("     probe: %s" % ("present (%d names)" % len(probe.get("verdicts", {}))
                              if probe else "ABSENT — nothing is engine-verified yet"))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--strict", action="store_true",
                        help="refuse to emit anything when the engine has not been probed")
    subs = parser.add_subparsers(dest="command")
    for name, fn in (("emit", cmd_emit), ("args", cmd_args), ("show", cmd_show)):
        sub = subs.add_parser(name)
        sub.add_argument("profile")
        sub.set_defaults(fn=fn)
    subs.add_parser("check").set_defaults(fn=cmd_check)
    args = parser.parse_args(argv)
    if not getattr(args, "fn", None):
        parser.print_help()
        return 2
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
