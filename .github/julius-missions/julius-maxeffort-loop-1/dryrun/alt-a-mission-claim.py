"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect A, with a different rule: a MISSION verdict on the verdict engine's ladder below verified_complete
(`claimed_complete`, `reviewed`, `approved`: a claim, a review, an approval, none of them verified; the WIDEST top segment) is itself a trust shortfall,
so with claim-only evidence it may still be claimed_complete. Every other failing check makes the Loop incomplete. Restructured as a list of the checks
that failed; `anyClaimOnly` is dropped (the trust check failing is the whole test, so zero, claim-only and observed-only evidence are treated alike).
Must PASS the spec. LADDER may be overridden by alt-a-ladder2.py."""
import pathlib
import sys

LADDER = sys.argv[1] if len(sys.argv) > 1 else "'claimed_complete', 'reviewed', 'approved'"
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
""", """  // Trust shortfalls: the trust check, and a mission verdict on a top segment of the ladder below verified_complete
  // (an approval, a review, a claim), which lacks verification without saying the work failed.
  const TRUST = 'blocking criteria supported by attested or verified evidence';
  const MISSION = 'mission verdict is verified_complete';
  const UNVERIFIED_LADDER: readonly (string | null)[] = [""" + LADDER + """];
  const failing = checks.filter((check) => !check.passed);
  const trustShortfall = (check: { requirement: string }): boolean =>
    check.requirement === TRUST || (check.requirement === MISSION && UNVERIFIED_LADDER.includes(input.missionVerdict));
  const onlyTrustIsMissing =
    failing.some((check) => check.requirement === TRUST) && failing.every(trustShortfall);
""")
path.write_text(text, encoding='utf-8', newline='')
print('alternative A (mission-verdict ladder [' + LADDER + '] counts as trust) applied')
