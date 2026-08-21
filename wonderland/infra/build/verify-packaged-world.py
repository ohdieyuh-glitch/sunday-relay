#!/usr/bin/env python3
"""Does the packaged build actually contain — and open — the world we generated?

THE FAILURE THIS CATCHES. The live stream worked and showed the wrong world: a
simple blocky scene with proxy-looking pawns and almost none of the built
Wonderland. Nothing was broken in the streaming path. The project had no
Config/ directory at all, so no GameDefaultMap was set and BuildCookRun was
invoked with no -map, and a packaged Unreal game with no map pinned opens the
engine's own default map. Every layer reported success because every layer was
succeeding.

Three separate questions, answered separately, because they fail independently:

  1. does the SOURCE pin the intended map (Config + the cook command)?
  2. is the generated map actually PRESENT in the staged package?
  3. does the runtime log say it OPENED that map, with a plausible actor count?

Exit 0 PASS   1 FAIL   2 package or log not available to check
"""
import io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, "..", ".."))
LAYOUT = os.path.join(PROJECT, "WorldDesign", "hub-layout.json")
CONFIG = os.path.join(PROJECT, "Config", "DefaultEngine.ini")
BUILD = os.path.join(HERE, "build-wonderland.sh")


def intended_level():
    with io.open(LAYOUT, encoding="utf8") as fh:
        return json.load(fh)["level"]          # /Game/Wonderland/Maps/WonderlandHub


def map_leaf(pkg):
    return pkg.rsplit("/", 1)[-1]


def check_source(level):
    """The map must be pinned where a packaged build will read it."""
    problems = []
    if not os.path.isfile(CONFIG):
        problems.append(
            "no Config/DefaultEngine.ini — a packaged build with no GameDefaultMap "
            "opens the engine default map, not %s" % level)
    else:
        text = io.open(CONFIG, encoding="utf8").read()
        if "GameDefaultMap" not in text:
            problems.append("Config/DefaultEngine.ini sets no GameDefaultMap")
        elif map_leaf(level) not in text:
            problems.append("GameDefaultMap does not name %s" % map_leaf(level))
    if os.path.isfile(BUILD):
        b = io.open(BUILD, encoding="utf8").read()
        if "-map=" not in b:
            problems.append(
                "build-wonderland.sh cooks with no -map; the cook then infers what "
                "to include and can omit the generated world entirely")
    return problems


def check_package(level):
    """The cooked .umap has to be in the staged tree, or nothing can open it."""
    root = None
    for v in ("WL_STAGED", "WL_OUT"):
        p = os.environ.get(v)
        if p:
            cand = p if os.path.basename(p) == "Linux" else os.path.join(p, "Linux")
            if os.path.isdir(cand):
                root = cand
                break
    if root is None:
        d = "/teamspace/studios/this_studio/wonderland/packaged/Linux"
        root = d if os.path.isdir(d) else None
    if root is None:
        return None, ["package not found (set WL_OUT)"]

    leaf = map_leaf(level).lower()
    hits, paks = [], []
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            low = fn.lower()
            if low.endswith(".umap") and leaf in low:
                hits.append(os.path.join(dirpath, fn))
            elif low.endswith(".pak") or low.endswith(".utoc"):
                paks.append(os.path.join(dirpath, fn))
    if hits:
        return root, []
    # A pak/utoc build hides the umap inside an archive; grep its bytes rather
    # than declaring a failure we cannot actually see.
    needle = map_leaf(level).encode()
    for p in paks:
        try:
            with open(p, "rb") as fh:
                while True:
                    chunk = fh.read(8 * 1024 * 1024)
                    if not chunk:
                        break
                    if needle in chunk:
                        return root, []
        except OSError:
            continue
    if paks:
        return root, ["%s is not referenced anywhere in the staged pak/utoc files"
                      % map_leaf(level)]
    return root, ["no %s.umap and no pak files in the package" % map_leaf(level)]


# NOT ANCHORED AT LINE START. Unreal prefixes every line with its category and
# verbosity — "LogWonderlandProof: Warning: WORLD=/Game/..." — so a ^WORLD=
# anchor matches nothing in a real log and the audit reported UNVERIFIED against
# every genuine app.log. It would have been silently useless in exactly the
# situation it exists for. Found by feeding it the real line format.
WORLD_RE = re.compile(r"\bWORLD=(\S+)")
COUNT_RE = {k: re.compile(r"\b%s=(\d+)\b" % k)
            for k in ("ACTORS", "RELAY_DOGS", "COMPOUND_AGENTS", "PROXY_ACTORS")}


def check_runtime(level):
    """What the running build said about itself, if it has run."""
    log = os.environ.get("WL_APP_LOG")
    if not log:
        for cand in ("/teamspace/studios/this_studio/wonderland/logs/app.log",):
            if os.path.isfile(cand):
                log = cand
                break
    if not log or not os.path.isfile(log):
        return None, ["no app.log to read (set WL_APP_LOG)"]
    text = io.open(log, encoding="utf8", errors="replace").read()
    m = WORLD_RE.search(text)
    if not m:
        return None, [
            "app.log carries no WORLD= line. Either this build predates the world "
            "proof, or the module never started."]
    facts = {"WORLD": m.group(1).strip()}
    for k, rx in COUNT_RE.items():
        mm = rx.search(text)
        facts[k] = int(mm.group(1)) if mm else None
    problems = []
    if map_leaf(level).lower() not in facts["WORLD"].lower():
        problems.append("the runtime opened '%s', not %s"
                        % (facts["WORLD"], map_leaf(level)))
    if facts["ACTORS"] is not None and facts["ACTORS"] < 500:
        problems.append("only %d actors at runtime — that is a template, not the "
                        "generated world" % facts["ACTORS"])
    return facts, problems


def main():
    level = intended_level()
    print("intended level: %s" % level)

    src = check_source(level)
    for p in src:
        print("  SOURCE FAIL : %s" % p)
    if not src:
        print("  SOURCE PASS : the map is pinned in Config and cooked explicitly")

    root, pkg = check_package(level)
    if root is None:
        print("  PACKAGE UNVERIFIED : %s" % "; ".join(pkg))
        pkg = []
    elif pkg:
        for p in pkg:
            print("  PACKAGE FAIL : %s" % p)
    else:
        print("  PACKAGE PASS : %s is present in %s" % (map_leaf(level), root))

    facts, rt = check_runtime(level)
    if facts is None:
        print("  RUNTIME UNVERIFIED : %s" % "; ".join(rt))
        rt = []
    else:
        print("  RUNTIME      : WORLD=%s ACTORS=%s RELAY_DOGS=%s COMPOUND_AGENTS=%s "
              "PROXY_ACTORS=%s" % (facts["WORLD"], facts["ACTORS"],
                                   facts["RELAY_DOGS"], facts["COMPOUND_AGENTS"],
                                   facts["PROXY_ACTORS"]))
        for p in rt:
            print("  RUNTIME FAIL : %s" % p)
        if not rt:
            print("  RUNTIME PASS : the built world is the one that loaded")

    if src or pkg or rt:
        print("FAIL: the packaged build does not match the generated world.")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
