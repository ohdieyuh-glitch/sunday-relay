"""THE SEED RE-CHECK of julius-joint-1: before ANY paid run, the seeded task3 files must be byte-equal at the FINAL RC's task3 commit.
Reads git only (read-only: rev-parse; no checkout, no write). Prints one line per file and a verdict.
Usage: python -I seed-recheck.py <task3 dir> <final RC task3 commit> [<SEED_MANIFEST.txt>, default: next to this file]
Exit 0 = SEED HOLDS (every file's blob at the commit == the manifest's); 1 = SEED DRIFTED (re-seed: a NEW mission folder, never an
edit of this one); 2 = cannot read."""
import os
import re
import subprocess
import sys

task3, commit = sys.argv[1], sys.argv[2]
manifest = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SEED_MANIFEST.txt')


def git(*args):
    return subprocess.run(['git', '-C', task3, '--no-optional-locks', '-c', 'safe.directory=*', *args],
                          capture_output=True, text=True)


lines = open(manifest, encoding='utf-8').read().split('\n')
seed = re.search(r'task3 ([0-9a-f]{40})', lines[0])
full = git('rev-parse', '--verify', commit + '^{commit}')
if not seed or full.returncode != 0:
    print('SEED RE-CHECK CANNOT READ', commit)
    sys.exit(2)
print(f'seed {seed.group(1)} -> final RC {full.stdout.strip()}')
drift = 0
for line in lines[1:]:
    m = re.fullmatch(r'(wonderland/\S+) ([0-9a-f]{40}) ([0-9a-f]{64})', line.strip())
    if not m:
        continue
    got = git('rev-parse', f'{commit}:{m.group(1)}')
    now = got.stdout.strip() if got.returncode == 0 else 'missing'
    same = now == m.group(2)
    drift += 0 if same else 1
    print(f'{"EQUAL  " if same else "DRIFTED"} {m.group(1)} seed {m.group(2)} final {now}')
print('SEED HOLDS' if drift == 0 else f'SEED DRIFTED ({drift} file(s)): re-seed in a NEW mission folder before any paid run')
sys.exit(0 if drift == 0 else 1)
