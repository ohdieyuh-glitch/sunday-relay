"""DRY-RUN ONLY: a WRONG fix for defect D: it treats only a `claim` as unsupporting, so observed-only evidence (excluded from support by the module's
own COMPLETION_SUPPORTING_TRUSTS) still verifies a Loop with no blocking criteria. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = "    passed: unsupported.length === 0,\n"
new = ("    passed: unsupported.length === 0\n"
       "      && (blocking.length > 0 || input.evidence.some((e) => e.sourceTrust !== 'claim')),\n")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix D (only claim is unsupporting) applied')
