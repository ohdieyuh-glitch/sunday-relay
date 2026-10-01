import copy
import json
import os
import tempfile
import unittest

from helpers import A1, A2, TempDirs, context, document, entry, item, link, tsv_edit
from julius_brain_intel.boundary import BrainSchemaError, load_bundle, parse_brain_document, parse_julius_context
from julius_brain_intel.boundary.evidence_bundle import (
    EMPTY_CONFIRMED, EMPTY_UNCONFIRMED, MALFORMED, MISSING, PRESENT, UNAVAILABLE, parse_table,
)
from julius_brain_intel.safety import CREDENTIAL, REASONING, forbidden_material, safe_text

# Deliberately fake, marked per the repository's convention, still the SHAPE the Brain refuses.
FAKE_KEY = "sk-ant-api03-FAKETESTNOTREAL"


class EvidenceBundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TempDirs()

    def tearDown(self):
        self.tmp.cleanup()

    def test_real_paid_bundle_reads_with_confirmed_footers(self):
        bundle = load_bundle(A2)
        self.assertEqual(bundle.manifest["workflow_run_id"], "36915013287")
        self.assertEqual(bundle.manifest["mode"], "paid")
        self.assertEqual(bundle.table("runs").status, PRESENT)
        self.assertEqual(bundle.table("runs").footer_count, 1)
        # A header with a "(0 rows)" footer is a query that RAN and found nothing.
        self.assertEqual(bundle.table("failures").status, EMPTY_CONFIRMED)
        self.assertEqual(bundle.table("settlement-integrity").status, EMPTY_CONFIRMED)
        self.assertEqual(bundle.problems, [])

    def test_older_bundle_without_manifest_is_unbound_not_invented(self):
        bundle = load_bundle(A1)
        self.assertFalse(bundle.manifest_present)
        self.assertEqual(bundle.manifest, {})
        self.assertTrue(any("bundle-manifest.txt missing" in p for p in bundle.problems))
        self.assertEqual(bundle.table("finding-status").status, MISSING)

    def test_each_table_status(self):
        problems = []
        self.assertEqual(parse_table("t", "a\tb\n1\t2\n(1 row)\n", problems).status, PRESENT)
        self.assertEqual(parse_table("t", "a\tb\n(0 rows)\n", problems).status, EMPTY_CONFIRMED)
        self.assertEqual(parse_table("t", "a\tb\n", problems).status, EMPTY_UNCONFIRMED)
        self.assertEqual(parse_table("t", "", problems).status, EMPTY_UNCONFIRMED)
        self.assertEqual(parse_table("t", "unavailable\n", problems).status, UNAVAILABLE)
        # A newline inside a cell splits a row: ragged, and the footer disagrees. Never guessed at.
        ragged = parse_table("t", "a\tb\n1\tline one\nline two\n(1 row)\n", problems)
        self.assertEqual(ragged.status, MALFORMED)
        self.assertTrue(any("ragged" in p for p in ragged.problems))
        mismatch = parse_table("t", "a\tb\n1\t2\n(3 rows)\n", problems)
        self.assertEqual(mismatch.status, MALFORMED)

    def test_credential_shaped_cell_is_withheld_on_load(self):
        path = self.tmp.bundle(A2, {"evidence.tsv": tsv_edit(lambda h, rows: [
            r if i else r[:3] + [f"leaked {FAKE_KEY}"] + r[4:] for i, r in enumerate(rows)])})
        bundle = load_bundle(path)
        summaries = bundle.table("evidence").column("safe_summary")
        self.assertNotIn(FAKE_KEY, json.dumps(summaries))
        self.assertIn("[withheld: credential-shaped content]", summaries)
        self.assertTrue(any(p.startswith("credential_shaped_content_withheld:evidence:") for p in bundle.problems))

    def test_a_missing_directory_is_an_error_not_an_empty_bundle(self):
        with self.assertRaises(FileNotFoundError):
            load_bundle(os.path.join(tempfile.gettempdir(), "no-such-julius-bundle-dir"))


class SafetyTests(unittest.TestCase):
    def test_refuses_the_brains_shapes(self):
        for text in (FAKE_KEY, "token ghp_FAKETESTNOTREALFAKETESTNOTREAL", "postgres://u:FAKETESTNOTREAL@h/db",
                     "-----BEGIN FAKETESTNOTREAL PRIVATE KEY-----", "password: hunter2hunter2"):
            self.assertEqual(forbidden_material(text), CREDENTIAL, text)
        self.assertEqual(forbidden_material("my chain-of-thought was"), REASONING)

    def test_a_file_name_is_not_a_key(self):
        # REGRESSION (run 36915013287): `sk-` matched inside these, so the Brain refused a person naming
        # Julius's own files and the evidence layer raised six false P0s.
        for text in ("src/relay/mission/julius/julius-task-contract.ts", "julius-task-pipeline.ts",
                     "a desk-organiser-v2 note", "the risk-assessment-matrix"):
            self.assertIsNone(forbidden_material(text), text)

    def test_safe_text_never_echoes_refused_material(self):
        self.assertNotIn(FAKE_KEY, safe_text(f"see {FAKE_KEY}"))
        self.assertEqual(safe_text("x" * 500, 10), "x" * 10 + "…")


class BrainDocumentTests(unittest.TestCase):
    def test_a_valid_document_parses(self):
        raw = document([item("pbr:a", "requirements", status="ADOPTED"), item("entry:1", "memory", source="JULIUS", status=None)],
                       [link("lnk:1", "pbr:a", "SUPPORTS", "entry:1")])
        doc = parse_brain_document(raw)
        self.assertEqual(doc.project_id, "prj-test")
        self.assertEqual(len(doc.sections["requirements"]), 1)
        self.assertTrue(doc.by_ref()["pbr:a"].live)
        self.assertEqual(doc.links[0].relation, "SUPPORTS")

    def test_strictness(self):
        base = document([item("pbr:a", "requirements")])
        cases = {
            "schema version": lambda d: d.update(schemaVersion="relay-project-brain.v2"),
            "a missing section": lambda d: d["sections"].pop("evals"),
            "an extra section": lambda d: d["sections"].update(gossip=[]),
            "an unknown status": lambda d: d["sections"]["requirements"][0].update(status="MAYBE"),
            "an unknown relation": lambda d: d.update(links=[link("l", "pbr:a", "LIKES", "pbr:a")]),
            "an item filed under the wrong section": lambda d: d["sections"]["requirements"][0].update(section="constraints"),
            "an unknown actor kind": lambda d: d["sections"]["requirements"][0].update(author={"kind": "INTERN", "id": "x"}),
            "a duplicate ref": lambda d: d["sections"]["constraints"].append(dict(d["sections"]["requirements"][0], section="constraints")),
            "a non-positive version": lambda d: d["sections"]["requirements"][0].update(version=0),
        }
        for name, mutate in cases.items():
            raw = copy.deepcopy(base)
            mutate(raw)
            with self.assertRaises(BrainSchemaError, msg=name):
                parse_brain_document(raw)

    def test_withdrawn_and_superseded_records_are_not_live(self):
        doc = parse_brain_document(document([item("pbr:w", "decisions", status="WITHDRAWN"),
                                             item("pbr:s", "decisions", status="SUPERSEDED"),
                                             item("pbr:d", "decisions", status="DECLINED")]))
        live = {i.ref: i.live for i in doc.items()}
        self.assertEqual(live, {"pbr:w": False, "pbr:s": False, "pbr:d": True})


class ContextTests(unittest.TestCase):
    def test_versioned_record_ids(self):
        ctx = parse_julius_context(context([entry("pbr:abc@v3"), entry("brain:decision:x")]))
        self.assertEqual(ctx.entries[0].record_ref, "pbr:abc")
        self.assertEqual(ctx.entries[0].record_version, 3)
        self.assertIsNone(ctx.entries[1].record_ref)

    def test_refuses_unknown_kind(self):
        bad = context([dict(entry("pbr:a@v1"), kind="GOSSIP")])
        with self.assertRaises(BrainSchemaError):
            parse_julius_context(bad)


if __name__ == "__main__":
    unittest.main()
