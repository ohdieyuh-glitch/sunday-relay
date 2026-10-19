"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect B: compare the parsed instants directly, before the rounding, and drop the later test. Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/evidence/evidence-contracts.ts')
text = path.read_text(encoding='utf-8')
old = "  const minutes = Math.round((retrieved - published) / 60000);\n  if (minutes < 0) return { minutes: null, freshness: 'unknown' };\n"
new = "  if (published > retrieved) return { minutes: null, freshness: 'unknown' };\n  const minutes = Math.round((retrieved - published) / 60000);\n"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative fix B (direct instant comparison) applied')
