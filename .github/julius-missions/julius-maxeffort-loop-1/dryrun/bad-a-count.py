"""DRY-RUN ONLY: a WRONG fix for defect A: "exactly one requirement failed, and the evidence was a claim" stands in for "only trust failed". With claim-only
evidence and no blocking criteria the UNFIXED trust check passes, so the one failure can be something else (durability) and is reported as a claim. Once
D's reference fix makes that trust check fail too, this becomes equivalent to strict A (exactly one reason, and it is the trust shortfall), so the
dry run lists it as an ALTERNATIVE with the D fix (pass), not as a wrong fix."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = """  const onlyTrustIsMissing =
    (anyClaimOnly || unsupported.length > 0) &&
    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0;
"""
new = """  const onlyTrustIsMissing = reasons.length === 1 && (anyClaimOnly || unsupported.length > 0);
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix A (one failure + a claim) applied')
