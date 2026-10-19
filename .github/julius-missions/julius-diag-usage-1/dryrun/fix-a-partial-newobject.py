"""DRY-RUN ONLY: a PARTIAL fix for defect A that carries the keys but always returns a NEW latch object, breaking the same-object-when-unchanged rule. Must FAIL."""
import pathlib, subprocess, sys

subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name('fix-a-latch.py'))], check=True)
path = pathlib.Path('src/relay/usage/usage-thresholds.ts')
text = path.read_text(encoding='utf-8')
old = "    latch: changed ? { keys: Object.freeze([...next].sort()) } : latch,"
new = "    latch: changed || true ? { keys: Object.freeze([...next].sort()) } : latch,"
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('partial fix A (new latch object each call) applied')
