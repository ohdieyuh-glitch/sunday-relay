import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertEnforceableWorkspaceCeiling, assertUnrenameableAncestry, outputBlocksFor } from './docker-sandbox-adapter';

/*
 * The two invariants that turn `workspaceBytes` from a recorded number into an enforced one, and that stop
 * the validated directory being renamed out from under its own mount. Measured before them: a 200,000-byte
 * write into a declared 65,536-byte ceiling completed in full.
 */
describe('workspace storage ceiling',()=>{
  it('refuses a ceiling the backing filesystem cannot hold',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-ceiling-'));
    // The temp directory's filesystem is far larger than this, so the declared ceiling is unenforceable.
    await expect(assertEnforceableWorkspaceCeiling(root,65_536)).rejects.toThrow('sandbox_workspace_ceiling_unenforceable');
  });

  it('accepts a ceiling at least as large as the store that enforces it',async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-ceiling-'));
    // Declaring more than the store is safe: the store binds tighter than the claim.
    await expect(assertEnforceableWorkspaceCeiling(root,Number.MAX_SAFE_INTEGER)).resolves.toBeUndefined();
  });

  it('refuses a workspace that does not exist',async()=>{
    await expect(assertEnforceableWorkspaceCeiling(join(tmpdir(),'julius-absent-workspace'),1)).rejects.toThrow('sandbox_workspace_invalid');
  });
});

describe('workspace ancestry',()=>{
  const layout=async()=>{
    const root=await mkdtemp(join(tmpdir(),'julius-ancestry-'));
    await mkdir(join(root,'fleet','tenant','ws'),{recursive:true});
    await chmod(root,0o755);await chmod(join(root,'fleet'),0o755);await chmod(join(root,'fleet','tenant'),0o755);
    await chmod(join(root,'fleet','tenant','ws'),0o777);
    await writeFile(join(root,'fleet','tenant','ws','file.txt'),'x');
    return root;
  };

  it('accepts a writable workspace whose ancestors are not writable by the sandbox user',async()=>{
    const root=await layout();
    await expect(assertUnrenameableAncestry(join(root,'fleet','tenant','ws'),join(root,'fleet'))).resolves.toBeUndefined();
  });

  it('refuses when the parent can be written, because the workspace can then be renamed away',async()=>{
    const root=await layout();
    await chmod(join(root,'fleet','tenant'),0o777);
    await expect(assertUnrenameableAncestry(join(root,'fleet','tenant','ws'),join(root,'fleet'))).rejects.toThrow('sandbox_workspace_parent_writable');
  });

  it('refuses when a grandparent can be written, since renaming it moves the whole path',async()=>{
    const root=await layout();
    await chmod(join(root,'fleet'),0o777);
    await expect(assertUnrenameableAncestry(join(root,'fleet','tenant','ws'),join(root,'fleet'))).rejects.toThrow('sandbox_workspace_parent_writable');
  });

  it('stops climbing at the governing root',async()=>{
    const root=await layout();
    // Above the root is not this executor's concern; the check must not walk to / and refuse on /tmp.
    await chmod(root,0o777);
    await expect(assertUnrenameableAncestry(join(root,'fleet','tenant','ws'),join(root,'fleet'))).resolves.toBeUndefined();
  });
});

describe('output block ceiling',()=>{
  /* bash counts `ulimit -f` in 1024-byte blocks. Deriving it from 512 handed every sandbox twice the output
     it declared, which is why the flood eval measured 65,674 bytes against a declared 32,768. */
  it('grants no more output than the declared ceiling',()=>{
    for(const declared of [1024,32_768,262_144,1_048_576]) expect(outputBlocksFor(declared)*1024).toBeLessThanOrEqual(declared);
    expect(outputBlocksFor(32_768)).toBe(32);
    // Never zero: a sandbox with a tiny ceiling still gets one block rather than an unlimited one.
    expect(outputBlocksFor(1)).toBe(1);
  });
});
