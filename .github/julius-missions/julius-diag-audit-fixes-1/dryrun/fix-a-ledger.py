"""DRY-RUN ONLY (never part of a mission): the reference fix for defect A (review ledger). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/review-repair.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("  const approvedReReviewExists = input.reviews.some((r, i) => i > 0 && r.verdict === 'approved');\n",
     "  // The first approving review AFTER a given review, or -1: an approval that came before a finding can never resolve it.\n"
     "  const firstApprovalAfter = (index: number): number => input.reviews.findIndex((x, i) => i > index && x.verdict === 'approved');\n")
swap("        const resolved = blocking && input.repairDispatched && approvedReReviewExists && input.postRepairEvidenceIds.length > 0;\n",
     "        const approvalIndex = firstApprovalAfter(index);\n"
     "        const resolved = blocking && input.repairDispatched && approvalIndex !== -1 && input.postRepairEvidenceIds.length > 0;\n")
swap("          resolutionReviewId: resolved ? `rvw_${input.reviews.findIndex((x, i) => i > index && x.verdict === 'approved') + 1}` : null,\n",
     "          resolutionReviewId: resolved ? `rvw_${approvalIndex + 1}` : null,\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix A applied')
