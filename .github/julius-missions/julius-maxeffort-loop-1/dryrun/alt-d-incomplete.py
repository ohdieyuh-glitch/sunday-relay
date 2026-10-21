"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect D, design choice 2: a Loop with NO blocking acceptance criterion has nothing that defines completion
and is never completable: a failing (non-trust) check is added for it, so it is incomplete whatever the evidence, attested included. Must PASS the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = "  const unknownIterations = input.iterations.filter((i) => i.outcome === 'unknown');\n"
new = """  // Nothing defines completion without a blocking criterion, so such a Loop is never completable: a claim (or
  // nothing at all) can never, on its own, end a Loop.
  if (blocking.length === 0) {
    checks.push({
      requirement: 'at least one blocking acceptance criterion',
      passed: false,
      detail: 'The Loop has no blocking acceptance criterion, so nothing defines completion and it cannot be verified complete.',
    });
  }

  const unknownIterations = input.iterations.filter((i) => i.outcome === 'unknown');
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('alternative D (no blocking criterion = not completable) applied')
