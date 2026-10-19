"""Zero-spend dry-run helper: rewrite decideJuliusApproval's check order in a THROWAWAY workspace.

Usage: python build_variant.py <variant>      (run with the workspace as the current directory)

The function today has four pieces, in this order (src/relay/mission/julius/julius-lifecycle-runtime.ts):
    CANCEL  the cancelled-run branch (WRITES decidedBy = the caller)
    DUP     the already-decided branch (ANSWERS the caller with the decision and the run state)
    BLANK   the blank approver / reason refusal
    AUTH    the approver-authority refusal

variants (the order is the whole difference):
    unfixed       CANCEL DUP BLANK AUTH            the seed, unchanged
    half          cancelled branch checked, duplicate branch not
    reference     BLANK AUTH CANCEL DUP            the correct change (an authorised caller sees exactly what it saw before)
    mut-a         CANCEL BLANK AUTH DUP            the cancelled branch writes before the checks
    mut-b         DUP BLANK AUTH CANCEL            the duplicate branch answers before the checks
    mut-c         AUTH CANCEL BLANK DUP            the blank check moved after the cancelled write
Every variant must find all four anchors exactly once, or the script exits 3 (a patch that does not apply must kill the
run, never leave the previous scenario standing).
"""
import re
import sys

PATH = 'src/relay/mission/julius/julius-lifecycle-runtime.ts'
variant = sys.argv[1]
src = open(PATH, encoding='utf8', newline='').read()
nl = '\r\n' if '\r\n' in src else '\n'
text = src.replace('\r\n', '\n')

A_CANCEL = '  // A CANCELLED RUN CANNOT BE APPROVED INTO LIFE.'
A_DUP = "  if (approval.state !== 'PENDING') {"
A_BLANK = '  if (!input.approverId.trim() || !input.reason.trim()) {'
A_AUTH = '  const permitted = await deps.approvers.mayApprove({'
A_END = '  const decided = await deps.store.decideApproval({'

def once(anchor):
    if text.count(anchor) != 1:
        print(f'ANCHOR NOT UNIQUE ({text.count(anchor)}): {anchor}')
        sys.exit(3)
    return text.index(anchor)

i_cancel, i_dup, i_blank, i_auth, i_end = (once(a) for a in (A_CANCEL, A_DUP, A_BLANK, A_AUTH, A_END))
if not (i_cancel < i_dup < i_blank < i_auth < i_end):
    print('ANCHORS OUT OF ORDER: the seed is not the shape this helper was written against')
    sys.exit(3)

pieces = {
    'CANCEL': text[i_cancel:i_dup],
    'DUP': text[i_dup:i_blank],
    'BLANK': text[i_blank:i_auth],
    'AUTH': text[i_auth:i_end],
}
head, tail = text[:i_cancel], text[i_end:]

if variant == 'half':
    # The checks run only on the cancelled branch; the duplicate branch still answers anyone.
    cancel_open = "  if (run.state === 'CANCELLED') {"
    assert pieces['CANCEL'].count(cancel_open) == 1
    guarded = pieces['CANCEL'].replace(
        cancel_open,
        "  if (run.state === 'CANCELLED') {\n" + '\n'.join('  ' + line if line else line for line in (pieces['BLANK'] + pieces['AUTH']).rstrip('\n').split('\n')) + '\n',
    )
    order = [guarded, pieces['DUP'], pieces['BLANK'], pieces['AUTH']]
else:
    sequences = {
        'unfixed': ['CANCEL', 'DUP', 'BLANK', 'AUTH'],
        'reference': ['BLANK', 'AUTH', 'CANCEL', 'DUP'],
        'mut-a': ['CANCEL', 'BLANK', 'AUTH', 'DUP'],
        'mut-b': ['DUP', 'BLANK', 'AUTH', 'CANCEL'],
        'mut-c': ['AUTH', 'CANCEL', 'BLANK', 'DUP'],
    }
    if variant not in sequences:
        print('UNKNOWN VARIANT ' + variant)
        sys.exit(2)
    order = [pieces[name] for name in sequences[variant]]

out = head + ''.join(order) + tail
open(PATH, 'w', encoding='utf8', newline='').write(out.replace('\n', nl))
print(f'variant {variant}: rewritten ({len(src)} -> {len(out)} chars)')
