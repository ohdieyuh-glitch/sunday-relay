"""DRY-RUN ONLY (never part of a mission): the reference fix for defect C (an impossible calendar date is not an instant). Run from the workspace root.

Rule chosen: the literal's own month, day and hour are checked against the proleptic Gregorian calendar BEFORE Date.parse (which rolls them forward);
hour 24 is refused (the regex's own two-digit hour is read as 00-23)."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/runtime/loop-scheduler.ts')
text = path.read_text(encoding='utf-8')
old = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const ms = Date.parse(value);
"""
new = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  // Date.parse ROLLS an impossible calendar date forward (2026-02-30 reads as 2026-03-02) and reads hour 24 as the next
  // day. Neither is an instant the text names, so the literal's own fields are checked first, in its own offset.
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (daysInMonth === undefined || day < 1 || day > daysInMonth || hour > 23) return null;
  const ms = Date.parse(value);
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('fix C applied')
