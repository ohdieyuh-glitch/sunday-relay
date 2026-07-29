/**
 * PSP AGENT ID — cross-surface domain parity manifest.
 *
 * The website/application and the CLI/terminal live in separate worktrees, so
 * neither can import the other's files. The PSP domain is therefore carried as
 * BYTE-IDENTICAL copies, and these checksums are what prove the copies have
 * not diverged into two contradictory implementations of the same business
 * rules.
 *
 * Each repository has a test that hashes its OWN copy of every module below
 * and asserts these digests. Because this manifest is itself byte-identical on
 * both sides, a rule changed on one surface and not mirrored on the other
 * fails that surface's test immediately.
 *
 * Changing the domain is a deliberate two-repository action:
 *   1. change the module,
 *   2. copy it verbatim into the other repository,
 *   3. recompute the digest and update this manifest in BOTH repositories,
 *   4. bump PSP_DOMAIN_MANIFEST_VERSION.
 *
 * `index.ts`, `psp-parity.ts` and the test files are deliberately NOT listed:
 * the surface re-export and this manifest are the only files allowed to differ
 * in incidental ways, and the tests are per-repository.
 *
 * PURE DATA — no imports.
 */

export const PSP_DOMAIN_MANIFEST_VERSION = '1.0.0';

export const PSP_DOMAIN_CHECKSUMS = {
  'psp-crypto.ts': 'a962dfcc345f0ac535662a47c2b2d7b063a73c3fe5d4c60766f0769786dfc928',
  'psp-agent-id.ts': 'dafcd43048f50db6853b7d3d25d57a34d994dc41b43b55113d666643dbd80882',
  'psp-errors.ts': '8155cf67c4bd821af3883426f34ecafec197ec5bb8780f16483eba2dbf95650a',
  'psp-entitlement.ts': '4e7a20163125ad33f50cf06adc8fd7c686f4f6b8fa8ad985b6ccb90027f50414',
  'psp-import.ts': '3b1b5adc5263e7cfc66673a6ea3bb8a981fc0ce326d1c263fca83adefe40a6e8',
  'psp-fixtures.ts': 'ada212fdf6ed8e3acbbc3120e2536e933ac4b5f8b7539ff20862ef5dc113fbe3',
  'psp-trace.ts': '1cb527ec665e2a0e78126dbe2eeccb37e5f3960eea5fd7116109f35fbe271cf8',
} as const;

export type PSPDomainModuleName = keyof typeof PSP_DOMAIN_CHECKSUMS;

export const PSP_DOMAIN_MODULE_NAMES = Object.keys(
  PSP_DOMAIN_CHECKSUMS,
) as PSPDomainModuleName[];

/** Where each surface keeps its copy. Nothing resolves these at runtime. */
export const PSP_DOMAIN_LOCATIONS = {
  website: 'src/relay/psp/',
  cli: 'src/relay/psp/',
} as const;
