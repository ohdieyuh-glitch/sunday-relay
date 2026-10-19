import unittest

from helpers import context, document, entry, item, link
from julius_brain_intel.boundary import parse_brain_document, parse_julius_context
from julius_brain_intel.memory_intelligence import (
    DISTRACTOR, SelectionPolicy, context_budget, detect_conflicts, detect_stale, evaluate_retrieval,
    history_usefulness, memory_report, select, selected_refs,
)


def doc(items, links=()):
    return parse_brain_document(document(list(items), list(links)))


class RetrievalTests(unittest.TestCase):
    JUDGED = {"a": 2, "b": 1, "c": 0, "d": DISTRACTOR}

    def test_metrics(self):
        r = evaluate_retrieval(["a", "d", "b", "c"], self.JUDGED, k=2)
        self.assertEqual(r["precisionAtK"], {"value": 0.5})
        self.assertEqual(r["recallAtK"], {"value": 0.5})
        self.assertEqual(r["mrr"], {"value": 1.0})
        self.assertEqual(r["distractorRateAtK"], {"value": 0.5})

    def test_ranking_order_matters(self):
        better = evaluate_retrieval(["a", "b", "c", "d"], self.JUDGED, k=4)["ndcgAtK"]["value"]
        worse = evaluate_retrieval(["d", "c", "b", "a"], self.JUDGED, k=4)["ndcgAtK"]["value"]
        self.assertAlmostEqual(better, 1.0)
        self.assertLess(worse, better)

    def test_no_judgments_is_unknown_never_perfect(self):
        r = evaluate_retrieval(["a", "b"], {}, k=2)
        for key in ("precisionAtK", "recallAtK", "mrr", "ndcgAtK", "distractorRateAtK"):
            self.assertIn("unknown", r[key], key)

    def test_unjudged_items_are_counted(self):
        self.assertEqual(evaluate_retrieval(["a", "zzz"], self.JUDGED, k=2)["unjudgedInTopK"], 1)


class StalenessTests(unittest.TestCase):
    def test_superseded_but_still_live(self):
        d = doc([item("pbr:old", "requirements", status="ADOPTED"), item("pbr:new", "requirements", status="ADOPTED")],
                [link("l1", "pbr:new", "SUPERSEDES", "pbr:old")])
        self.assertEqual([f["signal"] for f in detect_stale(d)], ["SUPERSEDED_LIVE"])

    def test_superseded_and_marked_so_is_not_flagged(self):
        d = doc([item("pbr:old", "requirements", status="SUPERSEDED"), item("pbr:new", "requirements", status="ADOPTED")],
                [link("l1", "pbr:new", "SUPERSEDES", "pbr:old")])
        self.assertEqual(detect_stale(d), [])

    def test_dead_record_in_julius_context_and_version_lag(self):
        d = doc([item("pbr:w", "requirements", status="WITHDRAWN", version=2), item("pbr:v", "constraints", version=3)])
        ctx = parse_julius_context(context([entry("pbr:w@v2"), entry("pbr:v@v1")]))
        signals = sorted(f["signal"] for f in detect_stale(d, ctx))
        self.assertEqual(signals, ["DEAD_IN_CONTEXT", "VERSION_LAG"])

    def test_cites_only_failed_evidence(self):
        d = doc([item("evidence:e1", "evidence", source="JULIUS", status="FAILED"),
                 item("pbr:claim", "decisions", evidence=("evidence:e1",))])
        self.assertEqual([f["signal"] for f in detect_stale(d)], ["CITES_FAILED"])

    def test_age_alone_is_not_staleness_without_a_policy(self):
        d = doc([item("pbr:old", "requirements", status="ADOPTED", recorded_at="2025-01-01T00:00:00.000Z")])
        self.assertEqual(detect_stale(d), [])
        self.assertEqual([f["signal"] for f in detect_stale(d, max_age_days=30)], ["OLDER_THAN_POLICY"])


class ConflictTests(unittest.TestCase):
    def test_linked_contradiction_between_live_items(self):
        d = doc([item("pbr:a", "decisions"), item("pbr:b", "decisions")], [link("l", "pbr:a", "CONTRADICTS", "pbr:b")])
        self.assertEqual([c["signal"] for c in detect_conflicts(d)], ["CONTRADICTION_LINKED"])

    def test_contradiction_with_a_withdrawn_item_is_resolved(self):
        d = doc([item("pbr:a", "decisions"), item("pbr:b", "decisions", status="WITHDRAWN")],
                [link("l", "pbr:a", "CONTRADICTS", "pbr:b")])
        self.assertEqual(detect_conflicts(d), [])

    def test_adopted_versus_declined_on_one_subject(self):
        d = doc([item("pbr:a", "requirements", status="ADOPTED", subject="mission:run:1"),
                 item("pbr:b", "requirements", status="DECLINED", subject="mission:run:1")])
        self.assertEqual([c["signal"] for c in detect_conflicts(d)], ["ADOPTED_VS_DECLINED"])

    def test_different_text_is_not_a_conflict(self):
        d = doc([item("pbr:a", "requirements", status="ADOPTED", subject="s", text="use tabs"),
                 item("pbr:b", "requirements", status="ADOPTED", subject="s", text="limit to 80 columns")])
        self.assertEqual(detect_conflicts(d), [])


class SelectionTests(unittest.TestCase):
    def test_scope_first_then_rank_then_budget(self):
        d = doc([
            item("pbr:mine", "requirements", status="ADOPTED", scope="MISSION", mission_ref="mission:run:1"),
            item("pbr:theirs", "requirements", status="ADOPTED", scope="MISSION", mission_ref="mission:run:2"),
            item("pbr:gone", "requirements", status="WITHDRAWN"),
            item("pbr:proposal", "requirements", status="PROPOSED"),
            item("pbr:big", "constraints", status="ADOPTED", text="x" * 5000),
            item("pbr:no", "decisions", status="DECLINED"),
        ])
        result = select(d, "run:1", SelectionPolicy(budget_chars=5100))
        refs = list(selected_refs(result))
        rejected = {r["ref"]: r["reason"] for r in result["rejected"]}
        self.assertNotIn("pbr:theirs", refs)
        self.assertEqual(rejected["pbr:theirs"], "another mission's item")
        self.assertEqual(rejected["pbr:gone"], "not live (WITHDRAWN)")
        self.assertEqual(rejected["pbr:no"], "declined")
        # Adopted outranks proposed (ties broken by ref), and everything fits in 5,100 characters.
        self.assertEqual(refs, ["pbr:big", "pbr:mine", "pbr:proposal"])
        self.assertEqual(result["charactersUsed"], 5000 + 2 * len("a statement"))
        # A tighter budget turns away what no longer fits, and says so.
        tight = select(d, "run:1", SelectionPolicy(budget_chars=5005))
        self.assertEqual(list(selected_refs(tight)), ["pbr:big"])
        self.assertEqual({r["ref"]: r["reason"] for r in tight["rejected"]}["pbr:mine"], "over the character budget")

    def test_deterministic(self):
        d = doc([item(f"pbr:{i}", "requirements", status="ACTIVE") for i in range(10)])
        self.assertEqual(select(d, None), select(d, None))


class BudgetAndHistoryTests(unittest.TestCase):
    def test_context_budget(self):
        ctx = parse_julius_context(context([entry("pbr:a@v1", "same text"), entry("pbr:b@v1", "same  text"),
                                            entry("pbr:c@v1", "other")]))
        budget = context_budget(ctx)
        self.assertEqual(budget["duplicateCharacters"], len("same  text"))
        self.assertIn("unknown", budget["relevantShare"])
        judged = context_budget(ctx, {"pbr:a": 1, "pbr:b": 0, "pbr:c": 0})
        self.assertAlmostEqual(judged["relevantShare"]["value"], len("same text") / budget["characters"])

    def test_history_usefulness(self):
        d = doc([item("carried:run:0:e1", "memory", source="JULIUS", status=None),
                 item("carried:run:0:e2", "memory", source="JULIUS", status=None),
                 item("pbr:decision", "decisions", evidence=("carried:run:0:e1",))])
        h = history_usefulness(d)
        self.assertEqual((h["carried"], h["cited"]), (2, 1))
        self.assertEqual(h["usedShareLowerBound"], {"value": 0.5})
        self.assertIn("unknown", history_usefulness(doc([item("pbr:x", "decisions")]))["usedShareLowerBound"])

    def test_memory_report_compares_julius_context_with_the_advisory_selection(self):
        d = doc([item("pbr:a", "requirements", status="ADOPTED"), item("pbr:b", "requirements", status="WITHDRAWN")])
        ctx = parse_julius_context(context([entry("pbr:a@v1"), entry("pbr:b@v1")]))
        report = memory_report(d, ctx, {"pbr:a": 2, "pbr:b": DISTRACTOR})
        self.assertEqual(report["schemaVersion"], "julius.memory-eval.v1")
        self.assertEqual(report["juliusContextQuality"]["distractorRateAtK"], {"value": 0.5})
        self.assertEqual(report["advisorySelectionQuality"]["distractorRateAtK"], {"value": 0.0})
        self.assertIn("DEAD_IN_CONTEXT", [f["signal"] for f in report["stale"]])


if __name__ == "__main__":
    unittest.main()
