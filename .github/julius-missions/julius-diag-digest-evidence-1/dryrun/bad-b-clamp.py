"""DRY-RUN ONLY: a WRONG fix for defect B: clamp the age to zero instead of reporting unknown. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/evidence/evidence-contracts.ts')
text = path.read_text(encoding='utf-8')
old = "  const minutes = Math.round((retrieved - published) / 60000);\n  if (minutes < 0) return { minutes: null, freshness: 'unknown' };\n"
new = "  const minutes = Math.max(0, Math.round((retrieved - published) / 60000));\n"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix B (clamp to zero) applied')
