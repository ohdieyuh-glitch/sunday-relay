"""DRY-RUN ONLY: a WRONG fix for defect A: it adds only the REVIEW requirement to the trust-only test (the case the module's own reasons make most
visible), leaving a failed or Unknown mission verdict and an undurable terminal write reported as a claim. Must FAIL the spec."""
import pathlib

path = pathlib.Path('src/relay/mission/loop/loop-completion.ts')
text = path.read_text(encoding='utf-8')
old = """    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0;
"""
new = """    unknownIterations.length === 0 &&
    input.openBlockingFindings === 0 &&
    reviewSatisfied;
"""
assert text.count(old) == 1
path.write_text(text.replace(old, new), encoding='utf-8', newline='')
print('wrong fix A (review only) applied')
