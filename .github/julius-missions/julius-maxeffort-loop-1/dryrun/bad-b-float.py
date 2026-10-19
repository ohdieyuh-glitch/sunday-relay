"""DRY-RUN ONLY: a WRONG fix for defect B: it drops the integer arithmetic and compares the spent fraction to the configured one in floating point
(`Number(spent) / Number(cap) >= f`). No rounding of f at all, but micros beyond 2^53 are no longer exact. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')
old = "      if (spent * PAUSE_DENOMINATOR >= pauseNumerator * cap) {\n"
new = "      if (Number(spent) / Number(cap) >= (request.autoPauseAtFraction as number)) {\n"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix B (float comparison) applied')
