"""DRY-RUN ONLY (never part of a mission): the HALF FIX. Makes boundOutput exact (UTF-8 bytes, never splits a character) and touches NOTHING in the runner.
Applied to a throwaway workspace by dryrun.sh. It must STILL FAIL the specification: bounding, redacting and decoding are done by the runner, not by this function.
Usage: python half-fix-bound-only.py   (run from the workspace root)"""
import pathlib
import sys

path = pathlib.Path('src/relay/workspace/output-sanitizer.ts')
text = path.read_text(encoding='utf-8')
start = text.index('export function boundOutput(')
old = text[start:]
assert old.count('conservative UTF-8 estimate') == 1, 'unexpected boundOutput body'
new = r'''export function boundOutput(text: string, limitBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= limitBytes) return { text, truncated: false };
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > limitBytes) break;
    bytes += size;
    end += ch.length;
  }
  return { text: `${text.slice(0, end)}\n[TRUNCATED: output limit reached]`, truncated: true };
}
'''
path.write_text(text[:start] + new, encoding='utf-8', newline='')
print('half fix applied: boundOutput is exact; the runner is untouched')
sys.exit(0)
