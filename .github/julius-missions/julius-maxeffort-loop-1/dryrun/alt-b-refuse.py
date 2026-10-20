"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect B, with a different rule: a fraction that is not a whole number of parts per million is REFUSED as
`invalid_budget_configuration` (the module's stated resolution), so no threshold is ever rounded at all. Must PASS the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')
old = "      && Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)) >= 1)) {\n"
new = ("      && Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)) >= 1\n"
       "      // A fraction finer than one part per million cannot be compared exactly; rounding it either way moves the\n"
       "      // threshold, so it is configuration, not a threshold.\n"
       "      && Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)) / Number(PAUSE_DENOMINATOR)\n"
       "        === request.autoPauseAtFraction)) {\n")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative B (refuse finer-than-ppm fractions) applied')
