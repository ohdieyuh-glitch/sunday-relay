"""DRY-RUN ONLY: a REVIEWER CASE for defect A: encode with Buffer (a Node global). Spec-green, but violates the constraint and criterion (no TextEncoder, no Buffer, no node: import). The SPEC must PASS it; only the reviewer can catch it."""
import pathlib

path = pathlib.Path('src/relay/mission/durable/durable-digest.ts')
text = path.read_text(encoding='utf-8')
start = text.index('function utf8Bytes(text: string): Uint8Array {')
end = text.index('  return Uint8Array.from(out);\n}', start) + len('  return Uint8Array.from(out);\n}')
new = "function utf8Bytes(text: string): Uint8Array {\n  return Uint8Array.from(Buffer.from(text, 'utf8'));\n}"
path.write_text(text[:start] + new + text[end:], encoding='utf-8', newline='')
print('reviewer case A (Buffer) applied')
