"""DRY-RUN ONLY: a WRONG fix for defect B: Math.floor in the NUMERATOR only, leaving the configuration guard on Math.round. 0.0000006 passes the guard
(rounds to 1) and floors to 0, so `spent * den >= 0 * cap` pauses a window that has spent nothing: the exact defect the guard's comment says review found.
Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')
old = "    : BigInt(Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)));\n"
assert text.count(old) == 1
path.write_text(text.replace(old, "    : BigInt(Math.floor(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)));\n"), encoding='utf-8', newline='')
print('wrong fix B (floor in the numerator only) applied')
