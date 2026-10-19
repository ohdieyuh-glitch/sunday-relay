"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect A: a regex pre-pass replacing every unpaired surrogate with U+FFFD. Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/durable/durable-digest.ts')
text = path.read_text(encoding='utf-8')
old = "function utf8Bytes(text: string): Uint8Array {\n  const out: number[] = [];\n"
new = ("function utf8Bytes(input: string): Uint8Array {\n"
       "  const text = input.replace(/[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]/g, '\\ufffd');\n"
       "  const out: number[] = [];\n")
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative fix A (regex pre-pass) applied')
