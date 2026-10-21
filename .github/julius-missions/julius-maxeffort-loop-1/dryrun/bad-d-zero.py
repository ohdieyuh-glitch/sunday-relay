"""DRY-RUN ONLY: a WRONG fix for defect D: it refuses only ZERO evidence when there are no blocking criteria; claim-only and observed-only evidence
still verify. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = "    passed: unsupported.length === 0,\n"
new = "    passed: unsupported.length === 0 && (blocking.length > 0 || input.evidence.length > 0),\n"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix D (zero evidence only) applied')
