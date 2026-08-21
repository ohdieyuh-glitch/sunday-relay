#!/usr/bin/env python3
"""What Marble has cost, derived from the manifests rather than remembered.

    python3 wonderland/marble/ledger.py
    python3 wonderland/marble/ledger.py --json=/tmp/ledger.json

The goal asks every iteration to report the Marble ID and cost. Those numbers
lived in conversation, which means they were re-derived from memory each time
and nobody else could check them.

Every credit figure here is read out of a world's own manifest, where the API
wrote it. LEDGER.json holds only what a manifest cannot know: the opening
balance, what was decided about each world, and any charge that produced no
world. A number that exists in two places is two numbers.

The reconciliation is a REFUSAL, not a note. If the derived balance and the last
balance the API actually reported disagree, something was charged that nothing
here recorded — which is exactly the state where a spending report is worse than
no report.
"""
import argparse
import glob
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, "LEDGER.json")
WORLDS = os.path.join(HERE, "worlds")


class LedgerRefusal(Exception):
    pass


def read_json(path):
    with io.open(path, encoding="utf8") as handle:
        return json.load(handle)


def _rank(what):
    return 0 if what == "generation" else 1


def charges(worlds_dir=None):
    """Every credit charge recorded in a world manifest, oldest first."""
    worlds_dir = worlds_dir or WORLDS
    out = []
    for manifest_path in sorted(glob.glob(os.path.join(worlds_dir, "*", "manifest.json"))):
        slug = os.path.basename(os.path.dirname(manifest_path))
        manifest = read_json(manifest_path)
        cost = manifest.get("cost") or {}
        total = cost.get("total_credits")
        if total:
            out.append({
                "at": manifest.get("generated_at") or "",
                "slug": slug,
                "world_id": manifest.get("marble_world_id"),
                "what": "generation",
                "credits": int(total),
                "detail": ", ".join(
                    "%s %s" % (i.get("name"), i.get("credits"))
                    for i in (cost.get("line_items") or [])),
            })
        for export in manifest.get("exports") or []:
            if export.get("credits"):
                out.append({
                    "at": manifest.get("generated_at") or "",
                    "slug": slug,
                    "world_id": manifest.get("marble_world_id"),
                    "what": "export %s/%s%s" % (
                        export.get("asset_type"), export.get("format"),
                        " " + export["mesh_variant"] if export.get("mesh_variant") else ""),
                    "credits": int(export["credits"]),
                    "detail": export.get("note") or "",
                })
    # Generation before its own exports. They share a timestamp — the manifest
    # records when the WORLD was generated, not when each charge landed — and an
    # alphabetical tie-break put "export" first, showing a world being exported
    # before it existed.
    out.sort(key=lambda row: (row["at"], row["slug"], _rank(row["what"])))
    return out


def build(ledger_path=None, worlds_dir=None):
    ledger_path = ledger_path or LEDGER
    if not os.path.exists(ledger_path):
        raise LedgerRefusal("no ledger at %s. Nothing was reported." % ledger_path)
    ledger = read_json(ledger_path)
    rows = charges(worlds_dir)
    for extra in ledger.get("other_charges") or []:
        rows.append({"at": extra.get("at", ""), "slug": extra.get("slug", "—"),
                     "world_id": extra.get("world_id"), "what": extra.get("what", "charge"),
                     "credits": int(extra["credits"]), "detail": extra.get("why", "")})
    rows.sort(key=lambda row: (row["at"], row["slug"], _rank(row["what"])))

    opening = int(ledger["opening_balance"])
    spent = sum(row["credits"] for row in rows)
    derived = opening - spent

    observed = ledger.get("last_observed_balance") or {}
    reconciled = None
    if observed.get("credits") is not None:
        reconciled = int(observed["credits"]) == derived

    dispositions = ledger.get("dispositions") or {}
    wasted = sum(row["credits"] for row in rows
                 if (dispositions.get(row["slug"]) or {}).get("verdict") == "rejected")

    return {
        "opening_balance": opening,
        "charges": rows,
        "spent": spent,
        "derived_balance": derived,
        "observed_balance": observed.get("credits"),
        "observed_at": observed.get("observed_at"),
        "reconciled": reconciled,
        "spent_on_rejected_worlds": wasted,
        "dispositions": dispositions,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", dest="json_out", default=None)
    parser.add_argument("--ledger", default=None)
    parser.add_argument("--worlds", default=None)
    args = parser.parse_args(argv)

    report = build(args.ledger, args.worlds)

    print("MARBLE CREDITS")
    print("  opening %d" % report["opening_balance"])
    print()
    running = report["opening_balance"]
    for row in report["charges"]:
        running -= row["credits"]
        verdict = (report["dispositions"].get(row["slug"]) or {}).get("verdict", "")
        print("  %-10s  %-26s  %-30s  %6d  -> %6d  %s"
              % (row["at"][:10], row["slug"], row["what"], row["credits"], running,
                 verdict))
        if row["detail"]:
            print("             %s" % row["detail"][:96])
    print()
    print("  spent %d, of which %d on worlds that were rejected"
          % (report["spent"], report["spent_on_rejected_worlds"]))
    print("  derived balance %d" % report["derived_balance"])
    if report["reconciled"] is None:
        print("  NOT RECONCILED: the ledger records no observed balance to check against.")
    elif report["reconciled"]:
        print("  reconciled against the balance the API reported on %s"
              % report["observed_at"])
    else:
        raise SystemExit(
            "LEDGER DOES NOT RECONCILE.\n"
            "  derived  %d  (opening %d minus %d recorded)\n"
            "  observed %d  (reported by the API on %s)\n"
            "Something was charged that nothing here records. A spending report "
            "that does not reconcile is worse than no report — find the missing "
            "charge before quoting either number."
            % (report["derived_balance"], report["opening_balance"], report["spent"],
               report["observed_balance"], report["observed_at"]))

    if args.json_out:
        with io.open(args.json_out, "w", encoding="utf8") as handle:
            json.dump(report, handle, indent=2, sort_keys=True)
            handle.write("\n")
        print("\nwrote %s" % args.json_out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
