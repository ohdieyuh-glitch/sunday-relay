"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect A, with a different rule: a required review that has NOT RUN yet, or that APPROVED but was not
structurally independent, is missing CORROBORATION (a trust shortfall), so it may still be claimed_complete. A review that ran and did not approve,
a mission verdict short of verified_complete, an open finding, an unknown iteration or an undurable terminal write is incomplete. Must PASS the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = """  const onlyTrustIsMissing =
    (anyClaimOnly || unsupported.length > 0) &&
    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0;
"""
new = """  // A review that has not happened, or an approval that was not independent, is missing corroboration; a review that
  // ran and did not approve is a contradiction, and is not.
  const reviewOnlyLacksCorroboration =
    reviewNeeded && (!input.reviewOccurred || (input.reviewApproved && !input.reviewerWasIndependent));
  const onlyTrustIsMissing =
    unsupported.length > 0 &&
    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0 &&
    input.missionVerdict === 'verified_complete' &&
    input.terminalWriteDurable &&
    (reviewSatisfied || reviewOnlyLacksCorroboration);
"""
assert text.count(old) == 1
text = text.replace(old, new)
old2 = "  const anyClaimOnly = input.evidence.length > 0 && supporting.length === 0;\n\n"
assert text.count(old2) == 1
text = text.replace(old2, "")
path.write_text(text, encoding='utf-8', newline='')
print('alternative A (pending or non-independent review = missing corroboration) applied')
