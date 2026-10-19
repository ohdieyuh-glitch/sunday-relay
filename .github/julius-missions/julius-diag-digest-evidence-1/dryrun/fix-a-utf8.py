"""DRY-RUN ONLY (never part of a mission): the reference fix for defect A (UTF-8 encoding of unpaired surrogates). Run from the workspace root."""
import pathlib

path = pathlib.Path('src/relay/mission/durable/durable-digest.ts')
text = path.read_text(encoding='utf-8')


def swap(old: str, new: str) -> None:
    global text
    assert text.count(old) == 1, f'anchor not found exactly once: {old[:70]!r}'
    text = text.replace(old, new)


swap("    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {\n      const next = text.charCodeAt(i + 1);\n      code = 0x10000",
     "    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {\n      const next = text.charCodeAt(i + 1);\n      code = 0x10000")
swap("    } else {\n      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));",
     "    } else {\n      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd; // an unpaired surrogate is U+FFFD, as TextEncoder and Node do\n      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));")
path.write_text(text, encoding='utf-8', newline='')
print('fix A applied')
