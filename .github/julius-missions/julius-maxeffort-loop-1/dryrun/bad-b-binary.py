"""DRY-RUN ONLY: a WRONG fix for defect B: it compares EXACTLY against the binary double's own value (mantissa / 2^k), not the decimal the fraction
is written as. A fraction whose double lies just above its decimal then no longer pauses at exactly that decimal. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/cron/cron-budget.ts')
text = path.read_text(encoding='utf-8')


def sub(old, new):
    global text
    assert text.count(old) == 1, old
    text = text.replace(old, new)


sub("""const PAUSE_DENOMINATOR = 1_000_000n;
""", """const PAUSE_DENOMINATOR = 1_000_000n;

/** The double's exact value as a rational: mantissa / 2^shift. */
const binaryFraction = (fraction: number): { readonly numerator: bigint; readonly denominator: bigint } => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, fraction);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent === 0 ? 0n : 1n << 52n);
  return { numerator: mantissa, denominator: 1n << BigInt(1075 - (exponent === 0 ? 1 : exponent)) };
};
""")
sub("""  const pauseNumerator = request.autoPauseAtFraction === null
    ? null
    : BigInt(Math.round(request.autoPauseAtFraction * Number(PAUSE_DENOMINATOR)));
""", """  const pause = request.autoPauseAtFraction === null ? null : binaryFraction(request.autoPauseAtFraction);
""")
sub("    if (pauseNumerator !== null) {\n", "    if (pause !== null) {\n")
sub("      if (spent * PAUSE_DENOMINATOR >= pauseNumerator * cap) {\n", "      if (spent * pause.denominator >= pause.numerator * cap) {\n")
path.write_text(text, encoding='utf-8', newline='')
print('wrong fix B (exact binary double) applied')
