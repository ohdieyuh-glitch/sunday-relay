import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {assertEnforceableWorkspaceCeiling,MINIMUM_INODE_COST} from './docker-sandbox-adapter';
import {BETA_WORKSPACE_BYTES,enforceableCeilingFor,tmpfsOptionsFor} from './workspace-provisioning';

/*
 * Three numbers used to be spelled out independently: the tmpfs `size=`, its `nr_inodes=`, and the declared
 * `workspaceBytes`. They sat exactly on the gate's boundary — 4096 inodes cost exactly 4 MiB against a 4 MiB
 * ceiling — with nothing anywhere asserting they agreed, so raising any one of them by a single unit would
 * have failed the real-infrastructure run with a refusal that named none of them. They are one decision now,
 * and these cases are what stops them drifting apart again.
 */
const backing=(blocks:number,files:number)=>async()=>({blocks,bsize:1,files});
const optionOf=(options:string,name:string)=>Number(new RegExp(`${name}=(\\d+)`).exec(options)?.[1]);

describe('the workspace provisioning contract',()=>{
  it('derives a mount the gate accepts, at the tightest legal size',async()=>{
    const options=tmpfsOptionsFor(BETA_WORKSPACE_BYTES);
    const size=optionOf(options,'size'),inodes=optionOf(options,'nr_inodes');
    // What the contract provisions is what the gate admits. Not asserted from the numbers: run through it.
    await expect(assertEnforceableWorkspaceCeiling('/any',BETA_WORKSPACE_BYTES,backing(size,inodes))).resolves.toBeUndefined();
    // And it is the TIGHTEST such mount: one byte or one inode more is refused. This is the assertion that
    // fails if `nr_inodes` is ever raised on its own, or if MINIMUM_INODE_COST moves underneath it.
    await expect(assertEnforceableWorkspaceCeiling('/any',BETA_WORKSPACE_BYTES,backing(size+1,inodes)))
      .rejects.toThrow('sandbox_workspace_ceiling_unenforceable');
    await expect(assertEnforceableWorkspaceCeiling('/any',BETA_WORKSPACE_BYTES,backing(size,inodes+1)))
      .rejects.toThrow('sandbox_workspace_inode_ceiling_unenforceable');
    expect(inodes*MINIMUM_INODE_COST).toBe(BETA_WORKSPACE_BYTES);
  });

  /* The mount is performed by the workflow, in YAML, where no type checker reaches. Binding the literal to
     the contract is the only thing that makes the derivation above true of the workspaces CI actually runs
     against — without it the module could be correct and the mount still wrong. */
  it('is the mount the real-infrastructure workflow actually performs',async()=>{
    const workflow=await readFile(fileURLToPath(new URL('../../../../.github/workflows/julius-real-infra.yml',import.meta.url)),'utf8');
    const mount=/mount -t tmpfs -o (\S+) tmpfs/.exec(workflow);
    expect(mount,'the workflow no longer mounts a tmpfs workspace').not.toBeNull();
    expect(mount![1]).toBe(tmpfsOptionsFor(BETA_WORKSPACE_BYTES));
  });

  it('reports a ceiling that is true of the store it measures',async()=>{
    // Blocks dominate: the ceiling is what the data can hold.
    await expect(enforceableCeilingFor('/any',backing(8_000,2))).resolves.toBe(8_000);
    // Inodes dominate: a store with a generous inode allowance costs more than its blocks suggest, and the
    // ceiling it can honestly carry is the larger of the two.
    await expect(enforceableCeilingFor('/any',backing(8_000,64))).resolves.toBe(64*MINIMUM_INODE_COST);
    // Whatever it reports must be a ceiling that same store passes the gate with, or callers of it get a
    // number the gate then refuses.
    const measured=backing(8_000,64);
    await expect(assertEnforceableWorkspaceCeiling('/any',await enforceableCeilingFor('/any',measured),measured)).resolves.toBeUndefined();
  });

  it('refuses to derive a ceiling from a store that reports no size',async()=>{
    await expect(enforceableCeilingFor('/any',backing(0,0))).rejects.toThrow('sandbox_workspace_ceiling_unenforceable');
  });
});
