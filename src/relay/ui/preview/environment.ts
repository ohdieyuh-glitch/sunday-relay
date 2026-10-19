/**
 * Build-environment facts for the Relay application shell.
 *
 * One thing the shipped product must get right, isolated here so it is
 * testable without a bundler:
 *
 * `siblingProductTarget()` — where the Alcatraz control goes. Sunday
 * Alcatraz is an Aquala SIBLING PRODUCT, not a route of this application:
 * `/` is Relay's own canonical entry, so sending the browser there never
 * reached Alcatraz. Alcatraz stays visible as a sibling — the relationship
 * is real and governance §11 permits documenting it — but the control is
 * only actionable when a URL is actually configured.
 *
 * HISTORY: this module used to export `IS_DEV_BUILD` to build-gate the
 * preview switcher out of production. Founder direction (2026-07-31) ships
 * the switcher with the offline demo product, so the gate is gone —
 * `production-entry.test.tsx` now asserts the switcher is PRESENT in the
 * built bundle.
 */

export type SiblingProductTarget =
  | { configured: true; url: string }
  | { configured: false; reason: string };

/**
 * Resolve the Alcatraz sibling-product URL from the build environment.
 *
 * Never hardcodes a live domain: this repository has no authority over where
 * Alcatraz is deployed, and guessing would ship a link that breaks the moment
 * that guess is wrong. Unset means the control is shown as unavailable, which
 * is the truthful state.
 */
export function siblingProductTarget(
  env: { VITE_ALCATRAZ_URL?: string } | undefined = safeEnv(),
): SiblingProductTarget {
  const raw = env?.VITE_ALCATRAZ_URL?.trim();
  if (!raw) {
    return {
      configured: false,
      reason: 'Sunday Alcatraz is a separate Aquala product. Set VITE_ALCATRAZ_URL to link to it.',
    };
  }
  // Only absolute http(s) URLs. A relative value would recreate the original
  // bug (a route this repository does not build), and a `javascript:` or
  // `data:` value assigned to `location.href` would be an injection sink.
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { configured: false, reason: 'VITE_ALCATRAZ_URL is not a valid absolute URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { configured: false, reason: 'VITE_ALCATRAZ_URL must be an http(s) URL.' };
  }
  return { configured: true, url: parsed.toString() };
}

function safeEnv(): { VITE_ALCATRAZ_URL?: string } | undefined {
  try {
    return import.meta.env as unknown as { VITE_ALCATRAZ_URL?: string };
  } catch {
    return undefined;
  }
}
