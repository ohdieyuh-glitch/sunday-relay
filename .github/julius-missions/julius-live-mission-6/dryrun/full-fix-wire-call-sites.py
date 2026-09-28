"""Wire the three search call sites to the helpers. Completes the full fix."""
import sys

p = sys.argv[1]
s = open(p, encoding='utf-8').read()

grep_old = "matches.push(`${relative(context.workspaceRoot,file)}:${index+1}:${line}`)"
grep_new = "matches.push(`${juliusSearchPath(relative(context.workspaceRoot,file))}:${index+1}:${line}`)"
assert grep_old in s, 'grep call site not found'
s = s.replace(grep_old, grep_new, 1)

find_old = (".map(file=>relative(context.workspaceRoot,file))"
            ".filter(file=>file.includes(needle.replaceAll('*','')))")
find_new = (".map(file=>juliusSearchPath(relative(context.workspaceRoot,file)))"
            ".filter(file=>juliusSearchNeedleMatches(file,needle))")
assert find_old in s, 'find/glob call site not found'
s = s.replace(find_old, find_new, 1)

open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('   three call sites rewired (grep, and find/glob which share one case)')
