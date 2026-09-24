# DOES AN AI COMPANION ACTUALLY ANSWER, END TO END?
#
# FOUNDER (2026-09-23), priority 4: "AI COMPANION TERMINAL -> selected companion -> real interaction path ->
# response -> correct terminal rendering -> continued conversation/state as supported."
#
# Wonderland's half of that is a view it renders; the part worth doubting is the runtime behind it. This drives
# the sidekick service directly over loopback -- the same door UWonderlandSidekickSubsystem uses -- and watches
# one full turn: ask, live turn opens, live turn closes, answer lands, turn counter moves.
#
# NOTHING IS SPENT AND NOTHING IS CONTACTED. Both companions are on development fixtures in SIMULATED mode, and
# this proof REFUSES to run against a real provider: if the companion is not SIMULATED it stops rather than send
# a founder's paid call. The founder's standing rule is that Wonderland must never claim a provider was
# contacted when none was, so this checks the mode first and reports it in every line it prints.
#
# IT DOES LEAVE A TRACE: one extra turn in that companion's development session, asked in this script's name.
#
#   python wonderland/Tools/sidekick_ask_proof.py [--sidekick llm-companion]
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8795/sidekicks/v1"
ASK = "Proof probe from wonderland/Tools/sidekick_ask_proof.py -- reply with anything."


def view():
    with urllib.request.urlopen(BASE + "/view", timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def intent(payload):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(BASE + "/intents", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def find(doc, sidekick_id):
    for s in doc.get("sidekicks", []):
        if s.get("sidekickId") == sidekick_id:
            return s
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sidekick", default="llm-companion")
    args = ap.parse_args()
    checks = []

    def record(name, ok, detail):
        checks.append(ok)
        print("%-4s %-44s %s" % ("PASS" if ok else "FAIL", name, detail))

    try:
        doc = view()
    except urllib.error.URLError as exc:
        record("the sidekick runtime is reachable", False,
               "%s -- start it with: npm run julius-connect:dev" % exc)
        return 1
    record("the sidekick runtime is reachable", bool(doc.get("ok")),
           "schema %s, revision %s" % (doc.get("schema"), doc.get("revision")))

    before = find(doc, args.sidekick)
    if before is None:
        record("the companion exists", False, "no sidekick called %s" % args.sidekick)
        return 1
    record("the companion exists and is connected", before.get("state") == "CONNECTED",
           "%s state=%s provider=%s" % (args.sidekick, before.get("state"), before.get("providerId")))

    # THE GUARD. A real provider means a real, paid call, and consent to spend is the founder's alone.
    if before.get("mode") != "SIMULATED":
        record("refusing to spend the founder's money on a proof", False,
               "mode is %s, not SIMULATED -- stopping without asking anything" % before.get("mode"))
        return 1
    record("the companion is on a fixture, so nothing is spent", True,
           "mode=SIMULATED provider=%s" % before.get("providerName"))

    turns_before = int(before.get("turns") or 0)
    # The field is "ask", not "text" -- taken from UWonderlandSidekickSubsystem::Ask, which is the
    # authority on this wire format. Guessing it cost a 409 ("ask needs something to say").
    sent = intent({"intent": "ask", "sidekickId": args.sidekick, "ask": ASK})
    record("the ask is accepted", bool(sent.get("ok")), json.dumps(sent)[:120])

    # WATCH A WHOLE TURN, rather than sleeping once and hoping. A companion that answered instantly and a
    # companion that never answered at all look identical to a single delayed read.
    saw_live = False
    answer = ""
    deadline = time.time() + 30.0
    while time.time() < deadline:
        cur = find(view(), args.sidekick)
        if cur is None:
            break
        if cur.get("live"):
            saw_live = True
        if int(cur.get("turns") or 0) > turns_before and not cur.get("live"):
            answer = cur.get("lastAnswer") or ""
            break
        time.sleep(0.4)

    record("a live turn was actually opened", saw_live,
           "the companion went to work rather than returning a canned line with no turn")
    record("the turn closed and the counter moved", bool(answer),
           "turns %d -> %d" % (turns_before, turns_before + (1 if answer else 0)))
    record("an answer came back", len(answer.strip()) > 0, "%d characters" % len(answer))
    record("and it says plainly that it is simulated", "SIMULATED" in answer.upper(),
           "first line: %s" % (answer.strip().split("\n")[0][:90] if answer else "(nothing)"))

    print("\n%d/%d checks passed" % (sum(1 for c in checks if c), len(checks)))
    print("NOTHING WAS CONTACTED: every line above came from a development fixture on this machine.")
    if answer:
        print("\n--- what the companion said ---")
        for line in answer.strip().split("\n")[:6]:
            print("  " + line[:110])
    return 0 if all(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
