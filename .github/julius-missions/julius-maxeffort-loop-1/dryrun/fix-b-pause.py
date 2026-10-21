"""DRY-RUN ONLY (never part of a mission): the reference fix for defect B (the pause threshold never moves up). Run from the workspace root.

Rule chosen: the numerator is the nearest whole part per million, stepped DOWN by one when that nearest value overshoots the configured fraction.
A six-decimal fraction is exact; a finer one pauses at most one part per million early; a fraction below one ppm is refused as configuration."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')


def sub(old, new):
    global text
    assert text.count(old) == 1, old
    text = text.replace(old, new)


sub("""const PAUSE_DENOMINATOR = 1_000_000n;
""", """const PAUSE_DENOMINATOR = 1_000_000n;

/**
 * The pause fraction in whole parts per million, NEVER rounded up: a threshold moved up pauses later than configured,
 * which is fail-open. The nearest value is kept when it does not overshoot (so a six-decimal fraction is exact, where a
 * plain floor would turn 0.000249 into 248 ppm through float error), and stepped down by one when it does.
 */
const pauseNumeratorOf = (fraction: number): number => {
  const nearest = Math.round(fraction * Number(PAUSE_DENOMINATOR));
  return nearest / Number(PAUSE_DENOMINATOR) > fraction ? nearest - 1 : nearest;
};
""")
sub("      && Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)) >= 1)) {\n",
    "      && pauseNumeratorOf(request.autoPauseAtFraction) >= 1)) {\n")
sub("    : BigInt(Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)));\n",
    "    : BigInt(pauseNumeratorOf(request.autoPauseAtFraction));\n")
path.write_text(text, encoding='utf-8', newline='')
print('fix B applied')
