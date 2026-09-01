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
  ])('%s',(_name,root,candidate,expected)=>expect(workspaceContained(root,candidate)).toBe(expected));
});
