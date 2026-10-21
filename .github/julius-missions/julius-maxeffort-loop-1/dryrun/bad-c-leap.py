"""DRY-RUN ONLY: a WRONG fix for defect C: a days-in-month table that gives February 29 days in EVERY year, so 2026-02-29 (and 2100-02-29) still roll
forward to March 1. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/runtime/loop-scheduler.ts')
text = path.read_text(encoding='utf-8')
old = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const ms = Date.parse(value);
"""
new = """export function readIsoInstantWithOffset(value: string): number | null {
  if (!ISO_WITH_OFFSET.test(value)) return null;
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (days === undefined || day < 1 || day > days) return null;
  const ms = Date.parse(value);
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix C (February always 29 days) applied')
