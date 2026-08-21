#!/usr/bin/env python3
"""The credit ledger reconciles, and refuses when it cannot."""
import io
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ledger as led                                             # noqa: E402

PASS, FAIL = [], []
ok = lambda m: (PASS.append(m), print("  ok   %s" % m))
bad = lambda m: (FAIL.append(m), print("  FAIL %s" % m))
check = lambda c, m: ok(m) if c else bad(m)


def world(root, slug, at, gen=None, exports=()):
    d = os.path.join(root, "worlds", slug)
    os.makedirs(d, exist_ok=True)
    manifest = {"marble_world_id": "id-" + slug, "generated_at": at,
                "cost": {"total_credits": gen} if gen else {}, "exports": list(exports)}
    json.dump(manifest, io.open(os.path.join(d, "manifest.json"), "w", encoding="utf8"))
    return os.path.join(root, "worlds")


def ledger_file(root, opening, observed=None, other=(), dispositions=None):
    payload = {"schema": "wonderland.marble.ledger/1", "opening_balance": opening,
               "other_charges": list(other),
               "dispositions": dispositions or {}}
    if observed is not None:
        payload["last_observed_balance"] = {"credits": observed, "observed_at": "2026-08-21"}
    path = os.path.join(root, "LEDGER.json")
    json.dump(payload, io.open(path, "w", encoding="utf8"))
    return path


def main():
    print("-- the real ledger --")
    report = led.build()
    check(report["reconciled"] is True,
          "the shipped ledger reconciles: opening %d - spent %d = %d, and the API "
          "reported %d" % (report["opening_balance"], report["spent"],
                           report["derived_balance"], report["observed_balance"] or -1))
    check(report["spent_on_rejected_worlds"] > 0,
          "…and it says how much was spent on worlds that were rejected (%d)"
          % report["spent_on_rejected_worlds"])
    kinds = [row["what"] for row in report["charges"] if row["slug"] == "royal-garden-backdrop"]
    check(kinds and kinds[0] == "generation",
          "a world's generation is listed before its exports, not after")
    check(all(row["credits"] > 0 for row in report["charges"]),
          "every listed charge has a credit figure from a manifest")

    root = tempfile.mkdtemp(prefix="ledger-")
    try:
        print("\n-- it refuses rather than quoting a number it cannot support --")
        worlds = world(root, "a", "2026-08-01T00:00:00Z", gen=1000)
        path = ledger_file(root, 5000, observed=4000)
        rep = led.build(path, worlds)
        check(rep["reconciled"] is True, "a ledger whose arithmetic works reconciles")
        # The state this exists for: a charge nobody recorded.
        path = ledger_file(root, 5000, observed=3500)
        rep = led.build(path, worlds)
        check(rep["reconciled"] is False, "a balance that does not match is NOT reconciled")
        try:
            led.main(["--ledger", path, "--worlds", worlds])
            bad("a mismatched ledger printed a report instead of refusing")
        except SystemExit as exc:
            text = str(exc)
            check("DOES NOT RECONCILE" in text and "worse than no report" in text,
                  "…and the CLI refuses, saying a charge is unaccounted for")

        path = ledger_file(root, 5000)
        rep = led.build(path, worlds)
        check(rep["reconciled"] is None,
              "with no observed balance it reports UNKNOWN, never success")

        print("\n-- charges that produced no world still count --")
        path = ledger_file(root, 5000, observed=3500,
                           other=[{"at": "2026-08-02T00:00:00Z", "what": "media upload retry",
                                   "credits": 500, "why": "a fixture"}])
        rep = led.build(path, worlds)
        check(rep["spent"] == 1500 and rep["reconciled"] is True,
              "an other_charge is included in the total and can make it reconcile")

        print("\n-- an export with no credits is not invented --")
        worlds = world(root, "b", "2026-08-03T00:00:00Z", gen=100,
                       exports=[{"asset_type": "splat", "format": "spz"}])
        path = ledger_file(root, 5000, observed=3400)
        rep = led.build(path, worlds)
        check(not [r for r in rep["charges"] if r["slug"] == "b" and "export" in r["what"]],
              "a FREE export adds no line, because a zero-credit charge is not a charge")
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
