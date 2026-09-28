import { describe, expect, it } from 'vitest';
import { workspaceContained } from './docker-sandbox-adapter';

/* The workspace root IS a valid workspace. A containment predicate that rejected it took the sibling CI
   down at the prepare step, so the boundary case is held here rather than discovered on real infrastructure. */
describe('workspace containment',()=>{
  it.each([
    ['the root itself','/srv/workspaces','/srv/workspaces',true],
    ['a child','/srv/workspaces','/srv/workspaces/run-1',true],
    ['a deep child','/srv/workspaces','/srv/workspaces/a/b/c',true],
    ['a climb out','/srv/workspaces','/srv',false],
    ['a sibling','/srv/workspaces','/srv/other',false],
    ['an unrelated absolute path','/srv/workspaces','/etc',false],
    ['a prefix collision','/srv/work','/srv/workspaces',false],
    /* WINDOWS, WHERE `relative` CANNOT ANSWER RELATIVELY. Across volumes it
       returns the target absolute, so a predicate that only looked for a leading
       slash and `..` called another drive contained — and this predicate gates
       the mount. These cases are written with explicit separators so they mean
       the same thing on either host: on POSIX they are exotic directory names
       under the root's parent and still not contained; on Windows they are the
       hole itself. Found by the integration lane measuring it here. */
    ['another drive','C:\\ws','D:\\secret\\x',false],
    ['a UNC share','C:\\ws','\\\\server\\share\\x',false],
    ['the same drive, outside','C:\\ws','C:\\other',false],
    ['the same drive, inside','C:\\ws','C:\\ws\\run-1',true],
  ])('%s',(_name,root,candidate,expected)=>expect(workspaceContained(root,candidate)).toBe(expected));
});
