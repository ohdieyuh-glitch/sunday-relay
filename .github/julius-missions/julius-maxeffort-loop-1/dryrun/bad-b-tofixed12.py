"""DRY-RUN ONLY: a WRONG fix for defect B: floor the product after toFixed(12), in both places. It cleans six-decimal float noise (248.99999999999997
becomes 249), but a fraction within the cleanup width below a ppm boundary (0.0000019999999999999 -> 1.9999999999998999 -> 2) is cleaned UP to it and
pauses late. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')
old = "Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR))"
assert text.count(old) == 2
new = "Math.floor(Number((request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)).toFixed(12)))"
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix B (toFixed(12) then floor) applied')
