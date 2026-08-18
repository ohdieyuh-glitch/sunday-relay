/**
 * WONDERLAND COLISEUM — THE SANDBOX GUARANTEE (PURE).
 *
 * A duel target is constructible ONLY from a `SandboxProvisioned` record, and
 * that record is producible ONLY by `provisionSandbox`. Two mechanisms carry
 * the guarantee together:
 *
 *  - a BRAND (unique symbol) so the type system refuses a plain literal, and
 *  - a MODULE-PRIVATE WeakSet registry so a runtime forger who casts past the
 *    brand is still refused by `isSandboxProvisioned`.
 *
 * THE GUARANTEE IS PER-PROCESS AND ACTIVATION-TIME ONLY. The registry is
 * in-memory: nothing persisted survives it. A durable `DuelRecord` stores
 * sandbox FACTS, not this capability, so any seam that executes work
 * (activation, fight planning) must demand a registry-checked record from
 * THIS process — a resumed duel must be re-provisioned.
 *
 * The REAL provisioning mechanism is `src/relay/workspace/worktree-manager.ts`
 * (Node-only — modeled here, deliberately never imported). A composition root
 * performs the actual copy and then records the fact through this step.
 */

declare const sandboxProvisionedBrand: unique symbol;

/**
 * Proof that a target has been COPIED into an isolated sandbox. It records
 * the source target and the sandbox copy id, so who-was-copied and
 * what-actually-runs stay separate facts.
 */
export interface SandboxProvisioned {
  readonly [sandboxProvisionedBrand]: true;
  /** What was copied — a reference, never the live system itself. */
  readonly sourceTargetRef: string;
  /** The isolated copy the duel actually runs against. */
  readonly sandboxCopyId: string;
  readonly provisionedAt: string;
}

/** Module-private. The ONLY way in is `provisionSandbox`. */
const PROVISIONED_REGISTRY = new WeakSet<object>();

export interface ProvisionSandboxInput {
  readonly sourceTargetRef: string;
  readonly sandboxCopyId: string;
  /** Injected ISO timestamp — this module never reads a clock. */
  readonly provisionedAt: string;
}

export function provisionSandbox(input: ProvisionSandboxInput): SandboxProvisioned {
  if (input.sourceTargetRef.trim() === '' || input.sandboxCopyId.trim() === '') {
    throw new Error('sandbox provisioning requires a source target ref and a sandbox copy id');
  }
  if (input.sourceTargetRef === input.sandboxCopyId) {
    throw new Error(
      'sandbox copy id must differ from the source target ref — a duel never runs on the live target',
    );
  }
  const record = Object.freeze({
    sourceTargetRef: input.sourceTargetRef,
    sandboxCopyId: input.sandboxCopyId,
    provisionedAt: input.provisionedAt,
  }) as SandboxProvisioned;
  PROVISIONED_REGISTRY.add(record);
  return record;
}

/** Registry membership — the runtime truth a brand alone cannot give. */
export function isSandboxProvisioned(value: unknown): value is SandboxProvisioned {
  return typeof value === 'object' && value !== null && PROVISIONED_REGISTRY.has(value);
}
