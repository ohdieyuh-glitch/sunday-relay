"""DRY-RUN ONLY: a WRONG fix for defect B: floor the product after cleaning float noise with toFixed(6), in both places. Exact for six-decimal
fractions, but a fraction within the cleanup width below a ppm boundary is cleaned UP to it and pauses late. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')
old = "Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR))"
assert text.count(old) == 2
new = "Math.floor(Number((request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)).toFixed(6)))"
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix B (toFixed(6) then floor) applied')
