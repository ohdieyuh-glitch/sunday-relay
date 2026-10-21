"""DRY-RUN ONLY: a WRONG fix for defect D: an early return of claimed_complete when there are no blocking criteria and nothing above "observed",
BEFORE the other requirements are evaluated, so a Loop whose terminal write is not durable is still reported as a claim. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = "  const unsupported = blocking.filter((c) => !supportedCriteria.has(c.id)).map((c) => c.id);\n"
new = old + """  if (blocking.length === 0 && supporting.length === 0) {
    const detail = 'There are no blocking criteria and no evidence above "observed", so nothing supports completion.';
    return {
      verdict: 'claimed_complete',
      reasons: [detail],
      checks: [{ requirement: 'blocking criteria supported by attested or verified evidence', passed: false, detail }],
      unsupportedBlockingCriterionIds: [],
    };
  }
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix D (early claimed_complete) applied')
