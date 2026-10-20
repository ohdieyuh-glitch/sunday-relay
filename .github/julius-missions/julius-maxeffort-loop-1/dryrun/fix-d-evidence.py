"""DRY-RUN ONLY (never part of a mission): the reference fix for defect D (with no blocking criteria, nothing above "observed" never verifies).

Rule chosen (design choice 1): the trust check also FAILS when there are no blocking criteria and no evidence above "observed", so such a Loop is
claimed_complete when nothing else fails (and incomplete when something else does). A Loop with no blocking criteria and attested evidence still verifies."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = """  checks.push({
    requirement: 'blocking criteria supported by attested or verified evidence',
    passed: unsupported.length === 0,
    detail:
      unsupported.length === 0
        ? `All ${blocking.length} blocking criteria have supporting evidence.`
"""
new = """  // With no blocking criteria there is nothing for evidence to support criterion by criterion, so completion needs SOME
  // evidence above "observed": a claim can never, on its own, end a Loop, and neither can silence.
  const nothingSupports = blocking.length === 0 && supporting.length === 0;
  checks.push({
    requirement: 'blocking criteria supported by attested or verified evidence',
    passed: unsupported.length === 0 && !nothingSupports,
    detail:
      nothingSupports
        ? 'There are no blocking criteria and no evidence above "observed", so nothing supports completion.'
        : unsupported.length === 0
        ? `All ${blocking.length} blocking criteria have supporting evidence.`
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('fix D applied')
