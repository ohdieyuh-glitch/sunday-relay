/**
 * Where the "i.Wonder" brandmark in the landing header points.
 *
 * i.Wonder Laboratories (the company) and Wonderland (this application) are
 * deliberately TWO SEPARATE deployments — this repository has no authority
 * over where the company site is hosted, so a hardcoded domain would ship a
 * link that breaks the moment that guess is wrong. Unset means the brandmark
 * renders as plain text, which is the truthful state, mirroring
 * `siblingProductTarget()` in `../preview/environment.ts` for the same reason.
 */

export type CompanyWebTarget =
  | { configured: true; url: string }
  | { configured: false; reason: string };

export function companyWebTarget(
  env: { VITE_IWONDER_WEB_URL?: string } | undefined = safeEnv(),
): CompanyWebTarget {
  const raw = env?.VITE_IWONDER_WEB_URL?.trim();
  if (!raw) {
    return { configured: false, reason: 'Set VITE_IWONDER_WEB_URL to link to the i.Wonder company site.' };
  }
  // Only absolute http(s) URLs — the same injection and dead-route guard as
  // the Alcatraz sibling-product link.
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { configured: false, reason: 'VITE_IWONDER_WEB_URL is not a valid absolute URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { configured: false, reason: 'VITE_IWONDER_WEB_URL must be an http(s) URL.' };
  }
  return { configured: true, url: parsed.toString() };
}

function safeEnv(): { VITE_IWONDER_WEB_URL?: string } | undefined {
  try {
    return import.meta.env as unknown as { VITE_IWONDER_WEB_URL?: string };
  } catch {
    return undefined;
  }
}
