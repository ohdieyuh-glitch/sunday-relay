"""Export the two helpers and wire NOTHING. The half fix, for the control."""
import sys

BS = chr(92)
p = sys.argv[1]
s = open(p, encoding='utf-8').read()

helpers = (
    "/** Every separator as `/`, on every host: the SPELLING only, nothing else. */\n"
    "export const juliusSearchPath=(relativePath:string):string=>"
    "relativePath.split('" + BS + BS + "').join('/');\n"
    "/** A match the separator spelling of neither side can decide. */\n"
    "export const juliusSearchNeedleMatches=(relativePath:string,needle:string):boolean=>"
    "juliusSearchPath(relativePath).includes(juliusSearchPath(needle.replaceAll('*','')));\n"
)

anchor = "export class NodeJuliusToolAdapter"
assert anchor in s, anchor
open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(anchor, helpers + anchor, 1))
print('   helpers exported, no call site touched')
