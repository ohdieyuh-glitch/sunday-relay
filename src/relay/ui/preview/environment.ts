/**
 * Build-environment facts for the Relay application shell.
 *
 * Two things the shipped product must get right, both isolated here so they
 * are testable without a bundler:
 *
 * 1. `IS_DEV_BUILD` — whether development-only affordances may render. The
 *    shell doubles as the founder's full-flow preview harness, and it used to
 *    render a `DEV PREVIEW` chip and a route/fixture switcher unconditionally,
 *    so the production bundle advertised development scaffolding as the
 *    product. Gating on the BUILD (not a runtime flag) lets the bundler drop
 *    the markup entirely.
 *
 * 2. `siblingProductTarget()` — where the Alcatraz control goes. Sunday
 *    Alcatraz is an Aquala SIBLING PRODUCT, not a route of this application:
 *    this repository builds `relay.html` only, so sending the browser to `/`
 *    was a dead link. Alcatraz stays visible as a sibling — the relationship
 *    is real and governance §11 permits documenting it — but the control is
 *    only actionable when a URL is actually configured.
 */

/**
 * True in `vite dev`; false in `vite build`.
 *
 * Written as a DIRECT reference on purpose. Vite statically replaces
 * `import.meta.env.DEV` with a literal at build time, which lets Rollup
 * tree-shake `{IS_DEV_BUILD && (...)}` away entirely — the development markup
 * and its strings never enter the production bundle. Wrapping this in a
 * try/catch IIFE (as a defensive first cut did) defeats that: the value is
 * still false at runtime, but the branch survives minification and the
 * `DEV PREVIEW` label ships. `production-entry.test.tsx` asserts against the
 * built bundle precisely to catch that regression.
 */
export const IS_DEV_BUILD: boolean = import.meta.env.DEV;

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
