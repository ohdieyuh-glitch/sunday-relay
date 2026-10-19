/**
 * WHAT AN EVIDENCE ROW MAY SAY ABOUT THE BYTES IT WAS DRAWN FROM.
 *
 * `julius_evidence` has carried two columns for this since #175 and used
 * neither honestly:
 *
 *   * `integrity_hash` was NULL on every row the Prompt Architect, the Coding
 *     Agent and the Independent Reviewer ever wrote — while the adapters
 *     COMPUTED the sha256 of the body, truncated it to sixteen characters and
 *     buried it in an English sentence. The digest existed; the column built to
 *     hold it did not receive it, so nothing could compare two runs, and
 *     nothing could ever check a body against what was reviewed.
 *
 *   * `artifact_ref` was written with a key into a `Map` that lives in one
 *     process — `plan:<runId>`, `diff:<runId>` — and that Map is gone the
 *     moment the process ends. A durable row pointed at a thing no later
 *     reader could ever resolve, and said nothing about that.
 *
 * A REFERENCE THAT CANNOT BE RESOLVED IS NOT A REFERENCE. It is the same rule
 * the rest of this runtime already keeps for numbers: a value nobody can
 * establish is null, never a plausible-looking stand-in. A process-local key
 * recorded in a durable column is worse than null, because null says "unknown"
 * and the key says "look here" to a reader who then finds nothing.
 *
 * So, until a durable artifact store backs these bodies, the truthful record of
 * an artifact is its DIGEST — which survives the process, identifies the bytes
 * exactly, and can be checked against a body if one is ever produced — and the
 * reference stays null.
 */

/** The digest of an artifact body: sha256, lowercase hex, exactly 64 characters. */
export const JULIUS_CONTENT_DIGEST_RE = /^[0-9a-f]{64}$/u;

/** Whether a value is a content digest this runtime will record as one. */
export const isJuliusContentDigest = (value: unknown): value is string =>
  typeof value === 'string' && JULIUS_CONTENT_DIGEST_RE.test(value);

/**
 * THE SCHEMES A DURABLE REFERENCE MAY USE.
 *
 * `artifact:` names a row in the artifact metadata a store owns; `local://` is
 * what `LocalJuliusArtifactStore.finalize` returns as its `storageRef`. Both
 * outlive the process that wrote them, which is the whole and only test.
 *
 * A key of a live in-process exchange — `plan:<runId>`, `diff:<runId>`,
 * `guidance:<taskId>`, `test-output:<runId>`, `base:<runId>` — matches none of
 * them, deliberately: those are how one process finds a body it is still
 * holding, and they are not facts about the world.
 */
const DURABLE_REFERENCE_RE = /^(?:artifact:[A-Za-z0-9][A-Za-z0-9._:-]{0,199}|local:\/\/[0-9a-f]{64}\/[0-9a-f]{64}\/[0-9a-f]{64})$/u;

/**
 * The reference, if it is one this runtime can promise a later reader; null
 * otherwise. Null is the honest answer for anything else, including a key that
 * means something to the process that wrote it.
 */
export const juliusDurableArtifactRef = (value: unknown): string | null =>
  (typeof value === 'string' && DURABLE_REFERENCE_RE.test(value) ? value : null);
