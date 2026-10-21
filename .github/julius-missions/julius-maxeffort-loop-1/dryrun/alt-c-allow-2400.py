"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect C, with a different rule on the one genuinely contested literal: `T24:00` (exactly; Date.parse already
refuses 24:01) is ISO 8601:2004's end-of-day midnight and is READ as the next day's 00:00, as before. Only the calendar date is checked. Must PASS the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/runtime/loop-scheduler.ts')
text = path.read_text(encoding='utf-8')
old = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const ms = Date.parse(value);
"""
new = """export function readIsoInstantWithOffset(value: string): number | null {
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  if (!ISO_WITH_OFFSET.test(value)) return null;
  // The calendar date must exist: Date.parse rolls 2026-02-30 forward to 2026-03-02. T24:00 (end-of-day midnight) is
  // ISO 8601:2004 and stays readable as the next day's 00:00.
  const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  const february29 = month === 2 && day === 29 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = DAYS_IN_MONTH[month - 1];
  if (days === undefined || day < 1 || (day > days && !february29)) return null;
  const ms = Date.parse(value);
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative C (calendar date only, T24:00 kept) applied')
