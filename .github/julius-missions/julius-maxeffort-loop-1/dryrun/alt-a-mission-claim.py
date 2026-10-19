"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect A, with a different rule: a MISSION verdict on the verdict engine's ladder below verified_complete
(`claimed_complete`, `reviewed`, `approved`: a claim, a review, an approval, none of them verified) is itself a trust shortfall, so with claim-only
evidence it may still be claimed_complete. Every other failing check makes the Loop incomplete. Keeps `anyClaimOnly`, restructured as a list of the
checks that failed. Must PASS the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = """  const onlyTrustIsMissing =
    (anyClaimOnly || unsupported.length > 0) &&
    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0;
"""
new = """  // Trust shortfalls: unsupported criteria, and a mission verdict on the ladder below verified_complete (a claim, a
  // review, an approval), which lacks verification without saying the work failed.
  const TRUST = 'blocking criteria supported by attested or verified evidence';
  const MISSION = 'mission verdict is verified_complete';
  const UNVERIFIED_LADDER: readonly (string | null)[] = ['claimed_complete', 'reviewed', 'approved'];
  const failing = checks.filter((check) => !check.passed);
  const trustShortfall = (check: { requirement: string }): boolean =>
    check.requirement === TRUST || (check.requirement === MISSION && UNVERIFIED_LADDER.includes(input.missionVerdict));
  const onlyTrustIsMissing =
    (anyClaimOnly || unsupported.length > 0) &&
    failing.some((check) => check.requirement === TRUST) &&
    failing.every(trustShortfall);
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative A (the unverified mission-verdict ladder counts as trust) applied')
