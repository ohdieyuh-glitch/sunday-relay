"""Resolve an ADDITIVE conflict in .github/julius-live-evidence-dump.sh.

Both sides append columns to the same `dump "SELECT ... " <file>.tsv` line. The
merge keeps OURS and splices in every column THEIRS added, immediately after the
column it follows on their side, so the result is a superset and neither side's
column is lost. Refuses anything that is not this shape.
"""
import re,sys
p='.github/julius-live-evidence-dump.sh'
s=open(p).read()
TOKEN=re.compile(r"e\.payload->[^,]*? AS (\w+),")

def by_file(block):
    out={}
    for line in block.splitlines(True):
        m=re.search(r'"\s+([\w.-]+\.tsv)\s*$', line.rstrip('\n'))
        out[m.group(1) if m else line] = line
    return out

changed=0
while True:
    m=re.search(r'^<<<<<<< HEAD\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n', s, re.S|re.M)
    if m is None: break
    ours,theirs=by_file(m.group(1)),by_file(m.group(2))
    if set(ours)!=set(theirs):
        sys.exit(f'conflict is not a same-file column addition: {sorted(ours)} vs {sorted(theirs)}')
    merged=[]
    for key in ours:
        o,t=ours[key],theirs[key]
        onames=[x.group(1) for x in TOKEN.finditer(o)]
        ttokens=[(x.group(0),x.group(1)) for x in TOKEN.finditer(t)]
        added=[(tok,name) for tok,name in ttokens if name not in onames]
        for tok,name in added:
            i=[n for _,n in ttokens].index(name)
            anchor=None
            for j in range(i-1,-1,-1):
                if ttokens[j][1] in onames: anchor=ttokens[j][0]; break
            if anchor is None: sys.exit(f'no anchor for added column {name} in {key}')
            if o.count(anchor)!=1: sys.exit(f'anchor not unique for {name} in {key}')
            o=o.replace(anchor,anchor+tok,1)
            onames.append(name)
        merged.append(o)
        if added: print(f'  {key}: took {[n for _,n in added]} from the incoming side')
    s=s[:m.start()]+''.join(merged)+s[m.end():]
    changed+=1
open(p,'w').write(s)
print(f'resolved {changed} conflict region(s) in {p}')
