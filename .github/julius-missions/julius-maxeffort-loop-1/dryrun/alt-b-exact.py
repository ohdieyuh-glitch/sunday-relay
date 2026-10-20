"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect B, with a different rule: the fraction is compared EXACTLY as the decimal it is written as
(its shortest round-trip form, e.g. 0.6666666 = 6666666 / 10^7), so nothing is rounded; a fraction below one part per million stays refused as
configuration. Must PASS the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')


def sub(old, new):
    global text
    assert text.count(old) == 1, old
    text = text.replace(old, new)


sub("""const PAUSE_DENOMINATOR = 1_000_000n;
""", """const PAUSE_DENOMINATOR = 1_000_000n;

/** The fraction as the exact decimal rational it is written as: no rounding in either direction. */
const exactFraction = (fraction: number): { readonly numerator: bigint; readonly denominator: bigint } => {
  const [mantissa = '', exponentText] = fraction.toString().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole = '', decimals = ''] = mantissa.split('.');
  const digits = BigInt(`${whole}${decimals}`);
  const scale = decimals.length - exponent;
  return scale >= 0
    ? { numerator: digits, denominator: 10n ** BigInt(scale) }
    : { numerator: digits * 10n ** BigInt(-scale), denominator: 1n };
};
""")
sub("      && Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)) >= 1)) {\n",
    "      && request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR) >= 1)) {\n")
sub("""  const pauseNumerator = request.autoPauseAtFraction === null
    ? null
    : BigInt(Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)));
""", """  const pause = request.autoPauseAtFraction === null ? null : exactFraction(request.autoPauseAtFraction);
""")
sub("""    if (pauseNumerator !== null) {
""", """    if (pause !== null) {
""")
sub("""      if (spent * PAUSE_DENOMINATOR >= pauseNumerator * cap) {
""", """      if (spent * pause.denominator >= pause.numerator * cap) {
""")
path.write_text(text, encoding='utf-8', newline='')
print('alternative B (exact decimal rational) applied')
