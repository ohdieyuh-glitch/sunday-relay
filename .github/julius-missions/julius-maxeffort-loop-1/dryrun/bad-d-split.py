"""DRY-RUN ONLY: a WRONG fix for defect D: never verified, always with a reason, but INCONSISTENT: claim-only or observed-only evidence fails the trust
check (claimed_complete), while ZERO evidence fails a separate non-trust check (incomplete). The same shortfall gets two verdicts. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')


def sub(old, new):
    global text
    assert text.count(old) == 1, old
    text = text.replace(old, new)


sub("    passed: unsupported.length === 0,\n",
    "    passed: unsupported.length === 0 && !(blocking.length === 0 && input.evidence.length > 0 && supporting.length === 0),\n")
sub("  const unknownIterations = input.iterations.filter((i) => i.outcome === 'unknown');\n", """  if (blocking.length === 0 && input.evidence.length === 0) {
    checks.push({ requirement: 'some evidence was offered', passed: false, detail: 'No evidence was offered and there are no blocking criteria.' });
  }
  const unknownIterations = input.iterations.filter((i) => i.outcome === 'unknown');
""")
path.write_text(text, encoding='utf-8', newline='')
print('wrong fix D (zero evidence and claim-only get different verdicts) applied')
