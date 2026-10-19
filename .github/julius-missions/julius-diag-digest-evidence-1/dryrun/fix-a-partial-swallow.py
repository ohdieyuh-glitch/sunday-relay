"""DRY-RUN ONLY: a PARTIAL fix for defect A that handles an unpaired high surrogate at the END and any lone LOW surrogate, but still lets a high surrogate followed by a non-low character swallow that character. Must still FAIL."""
import pathlib

path = pathlib.Path('src/relay/mission/durable/durable-digest.ts')
text = path.read_text(encoding='utf-8')
old = "    } else {\n      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));"
new = "    } else {\n      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;\n      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('partial fix A (swallow left) applied')
