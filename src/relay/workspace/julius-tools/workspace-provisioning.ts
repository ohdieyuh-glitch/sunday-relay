import {statfs} from 'node:fs/promises';
import {MINIMUM_INODE_COST,type WorkspaceBacking} from './docker-sandbox-adapter';

/**
 * THE BETA WORKSPACE-PROVISIONING CONTRACT
 *
 * `workspaceBytes` is enforced by the kernel, never by this process. Julius refuses a sandbox whose
 * workspace sits on a store larger than the declared ceiling (`assertEnforceableWorkspaceCeiling`),
 * so the operator carries one obligation:
 *
 *   A workspace MUST be provisioned on a backing store whose enforceable capacity — its data blocks
 *   AND its inode allowance — is less than or equal to the declared `workspaceBytes`.
 *
 * Supported for Beta: a per-workspace sized tmpfs, mounted with the options `tmpfsOptionsFor` derives.
 * Both terms matter. A tmpfs takes its inode count from host RAM rather than from its own size, so a
 * `size=`-only mount bounds bytes while leaving a sandbox free to pin hundreds of megabytes of kernel
 * memory that `df` and `du` both report as zero.
 *
 * Not supported for Beta, and refused rather than trusted: btrfs qgroups and ext4/XFS project quotas.
 * Both genuinely bound a subtree, but `statfs` reports the whole filesystem for them, so Julius cannot
 * observe the bound and fails closed. They are the natural next provisioning mechanisms; adding one
 * means teaching the gate to read that quota, not relaxing the rule.
 */

/** The ceiling the real-infrastructure suite declares, and the size its workspaces are mounted at. */
export const BETA_WORKSPACE_BYTES=4_194_304;

/**
 * The mount options a workspace of this size must be created with. `nr_inodes` is DERIVED, not chosen:
 * the gate refuses a store whose inode allowance costs more than the ceiling, so the two numbers are one
 * decision. Deployments must not spell these out independently — see workspace-provisioning.test.ts,
 * which binds this to the workflow that mounts them.
 */
export const tmpfsOptionsFor=(workspaceBytes:number):string=>
  `size=${workspaceBytes},nr_inodes=${Math.floor(workspaceBytes/MINIMUM_INODE_COST)},mode=0777,nosuid,nodev`;

/**
 * The smallest ceiling this store can honestly carry: the larger of what its blocks and its inodes cost.
 * For a workspace on an ordinary unsized filesystem this is the whole filesystem — a weak ceiling, but a
 * real one, which is the distinction the gate enforces. Lets a test declare a ceiling that is true of the
 * store it happens to run on instead of one nothing holds.
 */
export async function enforceableCeilingFor(workspace:string,measure:(path:string)=>Promise<WorkspaceBacking>=statfs):Promise<number>{
  const backing=await measure(workspace).catch(()=>null);
  if(!backing)throw new Error('sandbox_workspace_invalid');
  const total=Number(backing.blocks)*Number(backing.bsize),inodes=Number(backing.files);
  if(!(total>0)||!Number.isFinite(total))throw new Error('sandbox_workspace_ceiling_unenforceable');
  return Math.max(total,inodes>0?inodes*MINIMUM_INODE_COST:0);
}
