"""DRY-RUN ONLY: a REVIEWER CASE for defect A (NOT a valid alternative): a pre-pass with String.prototype.toWellFormed (ES2024). The seeded spec accepts it; the repository typecheck (lib ES2022) refuses it (TS2550). Must pass the SPEC and fail the TYPECHECK."""
import pathlib

path = pathlib.Path('src/relay/mission/durable/durable-digest.ts')
text = path.read_text(encoding='utf-8')
old = "function utf8Bytes(text: string): Uint8Array {\n  const out: number[] = [];\n"
new = "function utf8Bytes(input: string): Uint8Array {\n  const text = input.toWellFormed();\n  const out: number[] = [];\n"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative fix A (toWellFormed pre-pass) applied')
