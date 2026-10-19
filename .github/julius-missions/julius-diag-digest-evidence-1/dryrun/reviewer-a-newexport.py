"""DRY-RUN ONLY: a REVIEWER CASE for defect A: the correct fix plus a NEW exported helper. Spec-green; violates the no-export-change constraint and criterion. The SPEC must PASS it."""
import pathlib, subprocess, sys

subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name('fix-a-utf8.py'))], check=True)
path = pathlib.Path('src/relay/mission/durable/durable-digest.ts')
text = path.read_text(encoding='utf-8')
anchor = '/** UTF-8 bytes of a string, without TextEncoder (absent in some runtimes). */\n'
assert text.count(anchor) == 1
text = text.replace(anchor, "export function isUnpairedSurrogate(code: number): boolean {\n  return code >= 0xd800 && code <= 0xdfff;\n}\n\n" + anchor)
path.write_text(text, encoding='utf-8', newline='')
print('reviewer case A (new export) applied')
