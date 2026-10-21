"""DRY-RUN ONLY: a WRONG fix for defect C: month length from `new Date(Date.UTC(year, month, 0)).getUTCDate()`. Date.UTC reads years 0-99 as
1900-1999, so 0000-02-29 (a leap day in the proleptic Gregorian calendar) is refused. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/runtime/loop-scheduler.ts')
text = path.read_text(encoding='utf-8')
old = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const ms = Date.parse(value);
"""
new = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const ms = Date.parse(value);
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix C (Date.UTC month length) applied')
