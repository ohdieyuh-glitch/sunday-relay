/**
 * PSP AGENT ID — domain integrity manifest.
 *
 * There is ONE `src/relay/psp/`, and both product surfaces — the website and
 * the CLI — import it directly. Nothing here reconciles separate checkouts;
 * these digests guard the domain's own content against unreviewed drift.
 *
 * PSP identity is a credential domain: its import, entitlement and trace rules
 * decide what a purchased agent is allowed to do. `psp-domain.test.ts` hashes
 * every module listed below and asserts these digests, so a rule edited
 * without a matching, deliberate manifest update fails immediately instead of
 * landing unnoticed.
 *
 * Changing the domain is therefore a two-step, deliberate act:
 *   1. change the module,
 *   2. recompute its digest here and bump PSP_DOMAIN_MANIFEST_VERSION.
 *
 * `index.ts`, `psp-parity.ts` and the test files are deliberately NOT listed:
 * the barrel re-export and this manifest carry no business rules, and a
 * manifest cannot meaningfully checksum itself.
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

/** Where each surface reads the domain from — the same path twice, because
 * there is one copy. Nothing resolves these at runtime. */
export const PSP_DOMAIN_LOCATIONS = {
  website: 'src/relay/psp/',
  cli: 'src/relay/psp/',
} as const;
