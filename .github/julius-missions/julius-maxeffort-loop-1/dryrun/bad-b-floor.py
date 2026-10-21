"""DRY-RUN ONLY: a WRONG fix for defect B: Math.floor instead of Math.round, in both places. It never moves the threshold up, but float error floors
EXACT six-decimal fractions too (0.000249 * 1e6 = 248.99999999999997 -> 248 ppm), so a window below a deliberately set threshold pauses. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')
old = "Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR))"
assert text.count(old) == 2
path.write_text(text.replace(old, "Math.floor(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR))"), encoding='utf-8', newline='')
print('wrong fix B (plain floor) applied')
