/**
 * Round 5 R4-2 (PILOT 44c062b9): the ONLY constructor of an anchor the E2 gate accepts, in its own module.
 *
 * The anchor is the evidence chain's final hash as recorded OUTSIDE the capture (the workflow's own output, or a ledger
 * hash). The constructor takes an injected {@link WorkflowAnchorSource} (Skywalker's round-5 steering: a simple type she
 * can implement in the wiring without changing the gate). The gate and capture modules do not export a constructor; a
 * static import scan (e2-anchor-module-r10.test.ts) allows imports of this module only from the module itself, the
 * planned wiring module {@link E2_ANCHOR_WIRING_MODULE}, the gate (the brand checker only) and tests.
 *
 * HONEST LIMIT: this reduces ACCIDENTAL misuse (a caller anchoring on the file's own hash). It is not a security boundary
 * inside one process: any same-process code can still import this module. The real guarantee is the workflow-side source
 * (write the hash from the workflow right after capture, read it back from that output only); Skywalker wires the reader
 * and its test.
 */

export const E2_EXTERNAL_ANCHOR_SOURCES = Object.freeze(['workflow_output', 'ledger_hash'] as const);
export type E2ExternalAnchorSource = (typeof E2_EXTERNAL_ANCHOR_SOURCES)[number];
export type E2UntrustedAnchorSource = 'evidence_file' | 'capturing_process';
declare const ANCHOR_BRAND: unique symbol;
export interface ExternalAnchor { readonly finalHash: string; readonly source: E2ExternalAnchorSource | E2UntrustedAnchorSource; readonly [ANCHOR_BRAND]: true }

/** What the wiring injects: where the hash was read from, and the hash. An object with read(), or a plain function. */
export interface WorkflowAnchorSource { read(): { source: 'workflow_output' | 'ledger_hash'; hash: string } }
export type WorkflowAnchorReader = () => { source: 'workflow_output' | 'ledger_hash'; hash: string };
/** The planned wiring module (relay-bridge/julius/<name>.ts) allowed to import this one. */
export const E2_ANCHOR_WIRING_MODULE = 'e2-workflow-anchor-wiring';

const ANCHORS = new WeakSet<object>();
/** Builds the anchor from the injected source. A bad source, a non-object reading or a non-string hash throws. */
export function externalAnchor(from: WorkflowAnchorSource | WorkflowAnchorReader): ExternalAnchor {
  const got: unknown = typeof from === 'function' ? from() : (typeof from === 'object' && from !== null && typeof from.read === 'function' ? from.read() : null);
  if (typeof got !== 'object' || got === null) throw new TypeError('e2: anchor source returned nothing');
  const { source, hash } = got as { source?: unknown; hash?: unknown };
  if (!(E2_EXTERNAL_ANCHOR_SOURCES as readonly unknown[]).includes(source)) throw new TypeError(`e2: anchor source must be one of ${E2_EXTERNAL_ANCHOR_SOURCES.join(', ')}`);
  if (typeof hash !== 'string') throw new TypeError('e2: anchor hash must be a string');
  const a = Object.freeze({ finalHash: hash, source }) as ExternalAnchor;
  ANCHORS.add(a);
  return a;
}
/** Additive alias (Skywalker): the wiring branch already uses `externalAnchor` for the reviewer-key pin. */
export const e2ExternalAnchor = externalAnchor;
/** The runtime brand check the gate uses: made here, frozen, from the closed source set. */
export const isWorkflowAnchor = (a: unknown): a is ExternalAnchor => typeof a === 'object' && a !== null && ANCHORS.has(a)
  && (E2_EXTERNAL_ANCHOR_SOURCES as readonly string[]).includes((a as ExternalAnchor).source);
