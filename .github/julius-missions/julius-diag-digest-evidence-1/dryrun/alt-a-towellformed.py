"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect A: a one-line pre-pass with the built-in String.prototype.toWellFormed (unpaired surrogates become U+FFFD). Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/durable/durable-digest.ts')
text = path.read_text(encoding='utf-8')
old = "function utf8Bytes(text: string): Uint8Array {\n  const out: number[] = [];\n"
new = "function utf8Bytes(input: string): Uint8Array {\n  const text = input.toWellFormed();\n  const out: number[] = [];\n"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative fix A (toWellFormed pre-pass) applied')
