"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect B that keeps the rounding and catches the negative zero it produces (publication up to 30 s ahead). Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/evidence/evidence-contracts.ts')
text = path.read_text(encoding='utf-8')
old = "  if (minutes < 0) return { minutes: null, freshness: 'unknown' };\n"
new = "  if (minutes < 0 || Object.is(minutes, -0)) return { minutes: null, freshness: 'unknown' };\n"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative fix B (negative zero) applied')
