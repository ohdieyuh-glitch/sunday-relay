# WHAT IS GENUINELY READY TO INTEGRATE INTO WONDERLAND RIGHT NOW?
#
# FOUNDER (2026-09-23), priority 1: "Continuously inspect what Julius/Relay backend capabilities are actually
# ready and integrate them into Wonderland. Do NOT fabricate capabilities that are incomplete... Inspect the
# actual current backend first."
#
# That inspection should not be a thing someone does by reading source and remembering. This asks the running
# runtime, in one command, and sorts every capability into exactly three buckets:
#
#   READY            integrate it
#   AWAITING FOUNDER  a key, or consent to spend -- his decision, and nobody else can make it
#   NOT BUILT         the integration does not exist in this build; there is nothing to wire
#
# The third bucket is the one that matters most, because it is the one that tempts a fabricated implementation.
# A connector that reports INTEGRATION NOT BUILT has nothing behind it to call, and writing Wonderland code that
# pretends otherwise is precisely what the founder forbade.
#
#   python wonderland/Tools/julius_readiness.py
import json
import sys
import urllib.error
import urllib.request

HOST = "http://127.0.0.1:8795"


def get(path):
    """
    The BODY of a 4xx is the answer here, not an error to swallow.

    These routes say what is wrong in JSON and use the status to classify it, so throwing the body away turns a
    healthy "no page is open on that tab" -- which is the correct reply to asking for a frame from a tab nobody
    opened -- into an unexplained 404. The first draft of this report did exactly that and filed the Wonder Web
    browser under NOT BUILT, minutes after a different proof in this same directory had rendered a page with it.
    """
    try:
        with urllib.request.urlopen(HOST + path, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "_error": "HTTP %s" % exc.code}
    except Exception as exc:
        return {"ok": False, "_error": str(exc)}


def main():
    ready, awaiting, not_built = [], [], []

    # ---------------------------------------------------------------- AI companions
    side = get("/sidekicks/v1/view")
    if not side.get("ok"):
        print("sidekick runtime unreachable: %s" % side.get("_error", "no ok"))
    else:
        for p in side.get("providers", []):
            row = ("%s (%s)" % (p.get("displayName"), p.get("backs")), p.get("detail") or "")
            (ready if p.get("ready") else awaiting).append(row)
        for s in side.get("sidekicks", []):
            label = "companion %s" % s.get("sidekickId")
            detail = "%s on %s, mode %s" % (s.get("state"), s.get("providerName"), s.get("mode"))
            (ready if s.get("mode") == "REAL" else awaiting).append((label, detail))

    # ---------------------------------------------------------------- Julius Connect connectors
    surf = get("/julius-connect/v1/surface")
    body = surf.get("surface") or {}
    for c in body.get("services", []):
        row = ("connector %s" % c.get("displayName"), c.get("unavailableReason") or c.get("stateLabel") or "")
        if c.get("state") == "CONNECTED":
            ready.append(row)
        elif c.get("canConnect") or c.get("awaitingUser"):
            awaiting.append(row)
        else:
            not_built.append(row)

    # ---------------------------------------------------------------- Wonder Web live browser
    frame = get("/julius-connect/v1/browser/frame?tab=__readiness__")
    err = ((frame.get("error") or {}).get("code")) if isinstance(frame, dict) else None
    # "not-found: no page open" is the HEALTHY answer here: the route is alive and simply has no tab open.
    if err == "not-found":
        ready.append(("Wonder Web live browser", "route alive; run wonderweb_live_proof.py for a rendered page"))
    elif "_error" in frame:
        not_built.append(("Wonder Web live browser", frame["_error"]))
    else:
        ready.append(("Wonder Web live browser", json.dumps(frame)[:80]))

    for title, rows in (("READY TO INTEGRATE", ready),
                        ("AWAITING THE FOUNDER (a key, or consent to spend)", awaiting),
                        ("NOT BUILT IN THIS BUILD (nothing to wire; do not fabricate)", not_built)):
        print("\n=== %s: %d ===" % (title, len(rows)))
        for name, detail in rows:
            print("  %-34s %s" % (name, detail[:96]))

    print("\nmode=%s  revision=%s  project=%s"
          % (surf.get("mode"), surf.get("revision"), body.get("projectId")))
    print("Anything in the third bucket has no backend behind it. Wiring Wonderland to it would be invention.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
