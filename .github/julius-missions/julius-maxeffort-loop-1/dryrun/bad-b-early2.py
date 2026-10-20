"""DRY-RUN ONLY: a WRONG fix for defect B: like the reference, but it steps the overshooting nearest value down by TWO parts per million, so a
finer-than-ppm fraction pauses up to two ppm early (the requirement allows at most one). Exact six-decimal fractions are untouched. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')


def sub(old, new):
    global text
    assert text.count(old) == 1, old
    text = text.replace(old, new)


sub("""const PAUSE_DENOMINATOR = 1_000_000n;
""", """const PAUSE_DENOMINATOR = 1_000_000n;

const pauseNumeratorOf = (fraction: number): number => {
  const nearest = Math.round(fraction * Number(PAUSE_DENOMINATOR));
  return nearest / Number(PAUSE_DENOMINATOR) > fraction ? nearest - 2 : nearest;
};
""")
sub("      && Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)) >= 1)) {\n",
    "      && pauseNumeratorOf(request.autoPauseAtFraction) >= 1)) {\n")
sub("    : BigInt(Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)));\n",
    "    : BigInt(pauseNumeratorOf(request.autoPauseAtFraction));\n")
path.write_text(text, encoding='utf-8', newline='')
print('wrong fix B (two ppm early) applied')
