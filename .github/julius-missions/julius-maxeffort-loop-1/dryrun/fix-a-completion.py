"""DRY-RUN ONLY (never part of a mission): the reference fix for defect A (claimed_complete only for a pure trust shortfall). Run from the workspace root.

Rule chosen: the trust check is the ONLY check allowed to fail. A review that has not run, a non-independent review, a non-verified mission verdict,
an open finding, an unconfirmable iteration or a non-durable terminal write each make the Loop incomplete."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')


def sub(old, new):
    global text
    assert text.count(old) == 1, old
    text = text.replace(old, new)


sub("  const anyClaimOnly = input.evidence.length > 0 && supporting.length === 0;\n\n", "")
sub("""  const onlyTrustIsMissing =
    (anyClaimOnly || unsupported.length > 0) &&
    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0;
""", """  // ONLY trust: the trust check failed and every other requirement passed. A rejected review, a mission verdict short of
  // verified_complete or an undurable terminal write is a fact about the work, not a missing corroboration of it.
  const trustCheck = checks[0];
  const onlyTrustIsMissing =
    trustCheck !== undefined && !trustCheck.passed && checks.every((check) => check === trustCheck || check.passed);
""")
path.write_text(text, encoding='utf-8', newline='')
print('fix A applied')
