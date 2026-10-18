"""The integration acceptance PROXY for the design gate (see DESIGN_GATE_PROTOCOL_AND_ACCEPTANCE_r1).

Read-only. Exit 0 only if the pipeline builds EVERY entry of the gate's `upheld` input through
`juliusUpheldDisagreementOf` and no hand-built entry (an object literal naming reReviewTaskId) remains.
It is NOT part of any run: in a real run the reviewer reads the diff against the stated requirements.
"""
import re
import sys

text = open(sys.argv[1] + '/src/relay/mission/julius/julius-task-pipeline.ts', encoding='utf-8').read()
imported = re.search(r"import \{[^}]*juliusUpheldDisagreementOf[^}]*\} from './julius-accept-review-gate'", text) is not None
folds = [m.start() for m in re.finditer(r'upheld:\s*foldJuliusDisagreements\(rows\)', text)]
used = False
for start in folds:
    block = text[start:start + 400]
    used = used or 'juliusUpheldDisagreementOf(' in block
hand_built = re.search(r'reReviewTaskId:\s*item\.reReviewTaskId!?', text) is not None
ok = imported and used and not hand_built
print('integration_check imported=%s used_in_upheld_fold=%s hand_built_entry_remains=%s => %s' % (imported, used, hand_built, 'PASS' if ok else 'FAIL'))
sys.exit(0 if ok else 1)
