"""DRY-RUN ONLY: a PARTIAL fix for defect B that rejects only publications MORE than 30 s ahead (a tolerance), so 1-29 s ahead stays live. Must FAIL."""
import pathlib

path = pathlib.Path('src/relay/mission/evidence/evidence-contracts.ts')
text = path.read_text(encoding='utf-8')
old = "  const minutes = Math.round((retrieved - published) / 60000);\n  if (minutes < 0) return { minutes: null, freshness: 'unknown' };\n"
new = "  if (retrieved - published < -30000) return { minutes: null, freshness: 'unknown' };\n  const minutes = Math.round((retrieved - published) / 60000);\n  if (minutes < 0) return { minutes: null, freshness: 'unknown' };\n"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('partial fix B (30 s tolerance) applied')
