"""``python -m julius_brain_intel <command>``: every command prints one versioned JSON document.

    analyze-bundle DIR [--permitted PATH ...]     julius.evidence-analysis.v1
    quality DIR                                   julius.eval.v1 (mission_quality)
    compare BASELINE_DIR CANDIDATE_DIR            julius.eval.v1 (candidate_vs_baseline)
    memory BRAIN_JSON [--context JSON] [--judgments JSON] [--run RUN_ID]
                                                  julius.memory-eval.v1
    learning-validate REGISTRATION_JSON           the registration's digest, or why it is refused
    learning-evaluate REGISTRATION_JSON --baseline DIR ... --candidate DIR ... --started RUN=ISO ...
                                                  julius.learning-outcome.v1
    brain-check BRAIN_JSON                        parse a Brain document; counts per section
    vocabulary                                    the mirrored Brain vocabulary (for the drift test)

Exit status: 0 on success, 2 on a refused input (schema, registration), 1 on anything else.
Reads files only; writes nothing but stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .boundary.brain_document import BrainSchemaError, parse_brain_document, vocabulary
from .boundary.context_entries import parse_julius_context
from .boundary.evidence_bundle import load_bundle
from .evals.compare import compare_runs
from .evals.quality import mission_quality
from .evidence_analysis.report import analyze_bundle
from .learning.evaluate import evaluate_learning
from .learning.registry import RegistrationError, parse_registration
from .memory_intelligence import memory_report
from .safety import forbidden_material


def _json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _print(document: Any) -> None:
    text = json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False)
    # The last line of defence: a report never carries refused material, whatever fed it.
    if forbidden_material(text) is not None:
        raise RuntimeError("refusing to print a report containing credential- or reasoning-shaped content")
    sys.stdout.write(text + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="julius_brain_intel")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("analyze-bundle"); p.add_argument("dir"); p.add_argument("--permitted", nargs="*")
    p = sub.add_parser("quality"); p.add_argument("dir")
    p = sub.add_parser("compare"); p.add_argument("baseline"); p.add_argument("candidate")
    p = sub.add_parser("memory"); p.add_argument("brain"); p.add_argument("--context"); p.add_argument("--judgments")
    p.add_argument("--run")
    p = sub.add_parser("learning-validate"); p.add_argument("registration")
    p = sub.add_parser("learning-evaluate"); p.add_argument("registration")
    p.add_argument("--baseline", nargs="+", required=True); p.add_argument("--candidate", nargs="+", required=True)
    p.add_argument("--started", nargs="+", required=True, help="RUN_ID=ISO_TIMESTAMP, as GitHub records it")
    p = sub.add_parser("brain-check"); p.add_argument("brain")
    sub.add_parser("vocabulary")
    p = sub.add_parser("safety-classify", help="classify a JSON list of strings (for the cross-language parity test)")
    p.add_argument("corpus")
    args = parser.parse_args(argv)
    try:
        if args.command == "analyze-bundle":
            permitted = tuple(args.permitted) if args.permitted else None
            _print(analyze_bundle(load_bundle(args.dir), permitted))
        elif args.command == "quality":
            _print(mission_quality(analyze_bundle(load_bundle(args.dir))))
        elif args.command == "compare":
            _print(compare_runs(analyze_bundle(load_bundle(args.baseline)), analyze_bundle(load_bundle(args.candidate))))
        elif args.command == "memory":
            document = parse_brain_document(_json(args.brain))
            context = parse_julius_context(_json(args.context)) if args.context else None
            judgments = _json(args.judgments) if args.judgments else None
            _print(memory_report(document, context, judgments, args.run))
        elif args.command == "learning-validate":
            registration = parse_registration(_json(args.registration))
            _print({"registrationId": registration.registration_id, "digest": registration.digest(), "valid": True})
        elif args.command == "learning-evaluate":
            registration = parse_registration(_json(args.registration))
            started = dict(item.split("=", 1) for item in args.started)
            _print(evaluate_learning(registration, [analyze_bundle(load_bundle(d)) for d in args.baseline],
                                     [analyze_bundle(load_bundle(d)) for d in args.candidate], started))
        elif args.command == "brain-check":
            document = parse_brain_document(_json(args.brain))
            _print({"schemaVersion": "relay-project-brain.v1", "projectId": document.project_id,
                    "revision": document.revision, "counts": {k: len(v) for k, v in document.sections.items()},
                    "links": len(document.links), "missions": len(document.missions)})
        elif args.command == "vocabulary":
            _print(vocabulary())
        elif args.command == "safety-classify":
            corpus = _json(args.corpus)
            # Verdicts only, never the strings: the corpus holds deliberately secret-shaped text.
            sys.stdout.write(json.dumps([forbidden_material(str(text)) for text in corpus]) + "\n")
    except (BrainSchemaError, RegistrationError) as error:
        sys.stderr.write(f"refused: {error}\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
