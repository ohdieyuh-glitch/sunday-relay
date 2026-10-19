"""DRY-RUN ONLY: an ALTERNATIVE correct fix for defect A: rewrite the encoder as a code-point loop (for...of yields a lone surrogate as its own code point). Must PASS."""
import pathlib

path = pathlib.Path('src/relay/mission/durable/durable-digest.ts')
text = path.read_text(encoding='utf-8')
start = text.index('function utf8Bytes(text: string): Uint8Array {')
end = text.index('  return Uint8Array.from(out);\n}', start) + len('  return Uint8Array.from(out);\n}')
new = '''function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    let code = ch.codePointAt(0) as number;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}'''
path.write_text(text[:start] + new + text[end:], encoding='utf-8', newline='')
print('alternative fix A (code-point loop) applied')
