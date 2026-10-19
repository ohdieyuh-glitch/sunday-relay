"""DRY-RUN ONLY: a WRONG fix for defect A: it adds the RAW review, durability and mission flags to the trust-only test instead of the checks' results,
so a Loop that needs no review (its review flags are all false) can no longer be claimed_complete. Looks right; must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = """    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0;
"""
new = """    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0 &&
    input.missionVerdict === 'verified_complete' &&
    input.reviewOccurred && input.reviewApproved && input.reviewerWasIndependent &&
    input.terminalWriteDurable;
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix A (raw review flags) applied')
