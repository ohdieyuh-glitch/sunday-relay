/**
 * PSP AGENT ID — the credential format (PURE, browser-safe, shared verbatim).
 *
 * PRODUCT LANGUAGE: the user hears "PSP Agent ID". It behaves like an API key —
 * possessing a valid, authorized one lets an entitled user import a PSP
 * compound agent into their Relay Workspace.
 *
 * IMPLEMENTATION: a PSP Agent ID is NOT one flat identifier. It carries a
 * PUBLIC part and a SECRET part, and the two are never conflated:
 *
 *   PSP-AGENT-<version>-<publicPrefix>-<secret>-<checksum>
 *   \_______ public product identity ________/ \__ import authority __/
 *
 *   version       which credential format this is; also separates production
 *                 credentials from development fixtures
 *   publicPrefix  identifies the PSP agent PRODUCT. Safe to display, log and
 *                 trace. This is `pspAgentId` — it is NOT the bearer secret.
 *   secret        the import authority. High-entropy, never displayed after
 *                 entry, never persisted raw, never logged, never traced.
 *   checksum      typo detection over the normalized preceding segments; it
 *                 protects against mistyping, NOT against forgery.
 *
 * A publicly visible marketplace identifier therefore can never function as
 * the whole bearer secret: knowing `pspAgentId` tells you which product an ID
 * refers to and nothing about whether you may import it.
 *
 * NOTHING HERE MUTATES ITS INPUT and nothing here returns the raw secret.
 */

import { pspConstantTimeEqual, pspDomainDigest } from './psp-crypto';

/* ------------------------------ alphabet ------------------------------- */

/**
 * Crockford-style Base32: no I, L, O or U. Excluding them removes the classic
 * 1/I/l and 0/O confusions, and dropping U avoids accidental profanity. Case
 * is not significant — IDs normalize to upper case.
 */
export const PSP_AGENT_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const PSP_AGENT_ID_PREFIX = 'PSP-AGENT';
/** Length of each variable segment, in alphabet characters. */
export const PSP_AGENT_ID_PUBLIC_PREFIX_LENGTH = 6;
/** 26 chars over a 32-symbol alphabet = 130 bits of entropy. */
export const PSP_AGENT_ID_SECRET_LENGTH = 26;
export const PSP_AGENT_ID_CHECKSUM_LENGTH = 4;

/** Credential format versions that a PRODUCTION entitlement service accepts. */
export const PSP_AGENT_ID_PRODUCTION_VERSIONS: readonly string[] = ['1'];
/**
 * Version 0 is permanently reserved for DEVELOPMENT FIXTURES. Production
 * validation rejects it outright, so a fixture credential can never become a
 * real entitlement no matter how it reaches the system.
 */
export const PSP_AGENT_ID_FIXTURE_VERSION = '0';

export const PSP_AGENT_ID_CURRENT_VERSION = '1';

/* ----------------------------- normalizing ----------------------------- */

/**
 * Case handling is explicit: PSP Agent IDs are UPPER CASE. Lower case input is
 * accepted and normalized. Whitespace anywhere is ignored (users paste from
 * wrapped emails). The Crockford substitutions are applied so a hand-copied
 * `I`/`l` -> `1` and `O` -> `0` still resolve.
 *
 * The input is never mutated: a new string is always returned.
 */
export function normalizePspAgentId(input: string): string {
  return input
    .replace(/[\s ]+/g, '')
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/–|—|−/g, '-'); // en/em dash and minus sign -> hyphen
}

/* ------------------------------ checksum ------------------------------- */

/** Typo-detection checksum over the normalized body. Not a security control. */
export function pspAgentIdChecksum(version: string, publicPrefix: string, secret: string): string {
  const digest = pspDomainDigest('psp-agent-id/checksum/v1', version, publicPrefix, secret);
  let out = '';
  for (let i = 0; i < PSP_AGENT_ID_CHECKSUM_LENGTH; i += 1) {
    out += PSP_AGENT_ID_ALPHABET[parseInt(digest.slice(i * 2, i * 2 + 2), 16) % 32];
  }
  return out;
}

/* ------------------------------- parsing ------------------------------- */

export interface ParsedPspAgentId {
  /** The full normalized credential. Sensitive — never persist or display. */
  readonly normalized: string;
  /** Format version. */
  readonly credentialVersion: string;
  /** PUBLIC product identity — safe to display, log and trace. */
  readonly pspAgentId: string;
  /** SECRET import authority. Never persist raw, never display, never trace. */
  readonly secret: string;
  readonly checksum: string;
  /** True when this is a reserved development-fixture credential. */
  readonly isFixture: boolean;
}

export type PspAgentIdFormatFailure =
  | 'empty'
  | 'malformed'
  | 'unknown_version'
  | 'bad_checksum';

export type PspAgentIdParseResult =
  | { readonly ok: true; readonly value: ParsedPspAgentId }
  | { readonly ok: false; readonly reason: PspAgentIdFormatFailure };

const SEGMENT = `[${PSP_AGENT_ID_ALPHABET}]`;
const PATTERN = new RegExp(
  `^${PSP_AGENT_ID_PREFIX}-(\\d{1,3})-(${SEGMENT}{${PSP_AGENT_ID_PUBLIC_PREFIX_LENGTH}})`
  + `-(${SEGMENT}{${PSP_AGENT_ID_SECRET_LENGTH}})-(${SEGMENT}{${PSP_AGENT_ID_CHECKSUM_LENGTH}})$`,
);

/**
 * Parse and validate a PSP Agent ID's FORMAT. This proves the string is
 * well-formed and un-mistyped; it proves NOTHING about entitlement. Ownership
 * is decided only by the entitlement service.
 */
export function parsePspAgentId(input: string): PspAgentIdParseResult {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, reason: 'empty' };
  const normalized = normalizePspAgentId(input);
  const match = PATTERN.exec(normalized);
  if (!match) return { ok: false, reason: 'malformed' };

  const [, rawVersion, pspAgentId, secret, checksum] = match;
  const credentialVersion = String(Number(rawVersion));
  const known = credentialVersion === PSP_AGENT_ID_FIXTURE_VERSION
    || PSP_AGENT_ID_PRODUCTION_VERSIONS.includes(credentialVersion);
  if (!known) return { ok: false, reason: 'unknown_version' };

  // Constant-time so a mistyped credential cannot be probed character by
  // character through response timing.
  if (!pspConstantTimeEqual(checksum, pspAgentIdChecksum(credentialVersion, pspAgentId, secret))) {
    return { ok: false, reason: 'bad_checksum' };
  }

  return {
    ok: true,
    value: {
      normalized,
      credentialVersion,
      pspAgentId,
      secret,
      checksum,
      isFixture: credentialVersion === PSP_AGENT_ID_FIXTURE_VERSION,
    },
  };
}

export function isValidPspAgentIdFormat(input: string): boolean {
  return parsePspAgentId(input).ok;
}

/* ------------------------------ composing ------------------------------ */

/**
 * Build a credential from its parts. The secret material must be supplied by
 * the caller — this module deliberately owns NO randomness, so nothing here
 * can mint a production credential on a surface that has no secure backend.
 */
export function composePspAgentId(input: {
  credentialVersion: string;
  pspAgentId: string;
  secret: string;
}): string {
  const version = String(Number(input.credentialVersion));
  const pspAgentId = normalizePspAgentId(input.pspAgentId);
  const secret = normalizePspAgentId(input.secret);
  const checksum = pspAgentIdChecksum(version, pspAgentId, secret);
  return `${PSP_AGENT_ID_PREFIX}-${version}-${pspAgentId}-${secret}-${checksum}`;
}

/* ------------------------------- masking ------------------------------- */

export const PSP_AGENT_ID_MASK_CHARACTER = '•';

/**
 * The ONLY representation of a PSP Agent ID that may be displayed, written to
 * a record, or handed to a log. The public segments stay readable so a user
 * can tell which credential they entered; the secret and its checksum are
 * replaced by a fixed-length mask that reveals nothing about their length.
 */
export function maskPspAgentId(input: string): string {
  const parsed = parsePspAgentId(input);
  const mask = PSP_AGENT_ID_MASK_CHARACTER.repeat(16);
  if (!parsed.ok) return `${PSP_AGENT_ID_PREFIX}-${mask}`;
  const { credentialVersion, pspAgentId } = parsed.value;
  return `${PSP_AGENT_ID_PREFIX}-${credentialVersion}-${pspAgentId}-${mask}`;
}

/** Mask from already-parsed public parts (no credential in hand). */
export function maskFromPublicIdentity(credentialVersion: string, pspAgentId: string): string {
  return `${PSP_AGENT_ID_PREFIX}-${String(Number(credentialVersion))}-${pspAgentId}`
    + `-${PSP_AGENT_ID_MASK_CHARACTER.repeat(16)}`;
}

/* ---------------------------- fingerprinting --------------------------- */

export const PSP_AGENT_ID_FINGERPRINT_PREFIX = 'pspfp_';

/**
 * A stable, NON-REVERSIBLE fingerprint of a credential. Safe for records,
 * traces and support conversations: it correlates two sightings of the same
 * credential without being usable to import anything and without revealing
 * the secret. 128 bits of digest — collisions are not a practical concern.
 */
export function pspAgentIdFingerprint(input: string): string {
  const parsed = parsePspAgentId(input);
  const material = parsed.ok ? parsed.value.normalized : normalizePspAgentId(input);
  return PSP_AGENT_ID_FINGERPRINT_PREFIX
    + pspDomainDigest('psp-agent-id/fingerprint/v1', material).slice(0, 32);
}

/**
 * The SECRET VERIFIER for a credential, salted per entitlement. This is what a
 * credential store keeps so it can later answer "is this the right ID?"
 * without ever holding the ID. Never place this in a trace, a capsule, an
 * analytics event or a user-facing surface.
 */
export function pspAgentIdVerifier(input: string, salt: string): string {
  const parsed = parsePspAgentId(input);
  const material = parsed.ok ? parsed.value.normalized : normalizePspAgentId(input);
  return pspDomainDigest('psp-agent-id/verifier/v1', salt, material);
}

/** Constant-time verifier comparison — the only approved way to check a
 *  credential against a stored verifier. */
export function pspAgentIdMatchesVerifier(input: string, salt: string, verifier: string): boolean {
  return pspConstantTimeEqual(pspAgentIdVerifier(input, salt), verifier);
}

/* ------------------------------ redaction ------------------------------ */

/**
 * Scrub anything that LOOKS like a PSP Agent ID out of arbitrary text. The
 * last line of defence for logs, errors and terminal transcripts: even if a
 * credential reaches a string it should never have reached, it does not
 * survive to the output.
 */
const CREDENTIAL_SHAPE = new RegExp(
  `${PSP_AGENT_ID_PREFIX}-\\d{1,3}-${SEGMENT}{2,}-${SEGMENT}{8,}(-${SEGMENT}{2,})?`,
  'gi',
);

export function redactPspAgentIds(text: string): string {
  return text.replace(CREDENTIAL_SHAPE, `${PSP_AGENT_ID_PREFIX}-[REDACTED]`);
}

/** True when the text contains a full, well-formed PSP Agent ID. Used by the
 *  boundary tests that assert credentials never reach a sink. */
export function containsPspAgentId(text: string): boolean {
  CREDENTIAL_SHAPE.lastIndex = 0;
  const matches = text.match(CREDENTIAL_SHAPE);
  if (!matches) return false;
  return matches.some((candidate) => isValidPspAgentIdFormat(candidate));
}
