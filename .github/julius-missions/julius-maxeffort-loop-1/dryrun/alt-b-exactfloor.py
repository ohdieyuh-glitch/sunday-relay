"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect B: the fraction is read EXACTLY as the decimal it is written as, then floored to whole parts per
million in BigInt (never up); a fraction whose floor is zero ppm is refused as configuration. Must PASS the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')


def sub(old, new):
    global text
    assert text.count(old) == 1, old
    text = text.replace(old, new)


sub("""const PAUSE_DENOMINATOR = 1_000_000n;
""", """const PAUSE_DENOMINATOR = 1_000_000n;

/** The fraction as written (its shortest decimal form), in whole parts per million, floored exactly: never rounded up. */
const pauseNumeratorOf = (fraction: number): bigint => {
  const [mantissa = '', exponentText] = fraction.toString().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole = '', decimals = ''] = mantissa.split('.');
  const digits = BigInt(`${whole}${decimals}`);
  const scale = decimals.length - exponent;
  return scale >= 0 ? (digits * PAUSE_DENOMINATOR) / 10n ** BigInt(scale) : digits * 10n ** BigInt(-scale) * PAUSE_DENOMINATOR;
};
""")
sub("      && Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)) >= 1)) {\n",
    "      && pauseNumeratorOf(request.autoPauseAtFraction) >= 1n)) {\n")
sub("    : BigInt(Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)));\n",
    "    : pauseNumeratorOf(request.autoPauseAtFraction);\n")
path.write_text(text, encoding='utf-8', newline='')
print('alternative B (exact decimal, floored to ppm) applied')
