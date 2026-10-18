"""Synthetic patches for the zero-spend design gate (authored by JULIUS_DEV; no model wrote or saw them).

Each function edits a THROWAWAY copy of the workspace and asserts that its anchor text occurs exactly once, so a patch
that does not apply kills the run instead of leaving the previous scenario's answer standing.
"""
import os
import sys

GATE = 'src/relay/mission/julius/julius-accept-review-gate.ts'
PIPE = 'src/relay/mission/julius/julius-task-pipeline.ts'


def _edit(root, rel, pairs):
    path = os.path.join(root, rel)
    text = open(path, encoding='utf-8', newline='').read()
    for old, new in pairs:
        if text.count(old) != 1:
            sys.exit('PATCH DID NOT APPLY (%d matches) in %s: %r' % (text.count(old), rel, old[:70]))
        text = text.replace(old, new)
    open(path, 'w', encoding='utf-8', newline='').write(text)


def gate_and_helper(root):
    _edit(root, GATE, [
        ("import { juliusSegmentSubjectTaskId } from './julius-segment-lineage';\n",
         "import { juliusSegmentSubjectTaskId } from './julius-segment-lineage';\nimport type { JuliusDisagreement } from './julius-disagreement';\n"),
        ("  /** The re-review that decided it: the head of its dispatch lineage. */\n  readonly reReviewTaskId: string;\n}\n",
         "  /** The re-review that decided it: the head of its dispatch lineage. */\n  readonly reReviewTaskId: string;\n"
         "  /** The challenging review whose HOLD this resolution resolves. */\n  readonly holdReviewTaskId: string;\n}\n\n"
         "/** The gate's entry for a disagreement, or null unless it is a material challenge resolved ARCHITECT_UPHELD through a re-review. */\n"
         "export function juliusUpheldDisagreementOf(disagreement: JuliusDisagreement): JuliusUpheldDisagreement | null {\n"
         "  if (!disagreement.material || disagreement.status !== 'RESOLVED' || disagreement.resolution !== 'ARCHITECT_UPHELD' || disagreement.reReviewTaskId === null) return null;\n"
         "  return { subjectTaskId: disagreement.subjectTaskId, reReviewTaskId: disagreement.reReviewTaskId, holdReviewTaskId: disagreement.reviewTaskId };\n}\n"),
        ("input.upheld.filter((item) => item.subjectTaskId === input.subject.taskId).map(",
         "input.upheld.filter((item) => item.subjectTaskId === input.subject.taskId && item.holdReviewTaskId === own.reviewTaskId).map("),
    ])


def pipeline_with_helper(root):
    _edit(root, PIPE, [
        ("  assertJuliusAcceptCitesReview, juliusAcceptReviewGate, juliusDecisionUnderReviewGate, type JuliusAcceptReviewGate,\n",
         "  assertJuliusAcceptCitesReview, juliusAcceptReviewGate, juliusDecisionUnderReviewGate, juliusUpheldDisagreementOf, type JuliusAcceptReviewGate,\n"),
        ("    upheld: foldJuliusDisagreements(rows)\n"
         "      .filter((item) => item.material && item.status === 'RESOLVED' && item.resolution === 'ARCHITECT_UPHELD' && item.reReviewTaskId !== null)\n"
         "      .map((item) => ({ subjectTaskId: item.subjectTaskId, reReviewTaskId: item.reReviewTaskId! })),\n",
         "    upheld: foldJuliusDisagreements(rows).flatMap((item) => juliusUpheldDisagreementOf(item) ?? []),\n"),
    ])


def pipeline_inline_only(root):
    _edit(root, PIPE, [
        ("      .map((item) => ({ subjectTaskId: item.subjectTaskId, reReviewTaskId: item.reReviewTaskId! })),\n",
         "      .map((item) => ({ subjectTaskId: item.subjectTaskId, reReviewTaskId: item.reReviewTaskId!, holdReviewTaskId: item.reviewTaskId })),\n"),
    ])


if __name__ == '__main__':
    root, what = sys.argv[1], sys.argv[2]
    {'gate_and_helper': gate_and_helper, 'pipeline_with_helper': pipeline_with_helper, 'pipeline_inline_only': pipeline_inline_only}[what](root)
