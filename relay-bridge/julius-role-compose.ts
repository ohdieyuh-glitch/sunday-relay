import type { RoleProvider } from './julius-dispatch';

/**
 * Composition checks for the three role ports, kept in their own file so the controller can REQUIRE them without importing the
 * provider adapters. Re-exported by julius-dispatch-adapters.ts.
 */

export type ModelVendor = 'openai' | 'anthropic' | 'xai';

/** Provider-routed prefixes (`anthropic/claude-x`, `x-ai/grok-4`): the segment names the vendor. */
const ROUTE_VENDOR: Readonly<Record<string, ModelVendor>> = Object.freeze({ openai: 'openai', anthropic: 'anthropic', xai: 'xai', 'x-ai': 'xai' });
/** Known model-name prefixes. `o3`, `o4-mini` and `gpt-5` are all OpenAI; `claude-*` Anthropic; `grok-*` xAI. */
const NAME_VENDOR: readonly (readonly [RegExp, ModelVendor])[] = Object.freeze([
  [/^(gpt-|gpt\d|chatgpt-|codex-|o\d+(-|$))/u, 'openai'],
  [/^claude(-|$)/u, 'anthropic'],
  [/^grok(-|$)/u, 'xai'],
]);

/**
 * The vendor behind a model name, from an EXPLICIT map, or null when it cannot be mapped (the composition then fails closed).
 * A routed form is accepted only when its route segment and its name agree; a conflict (`openai/claude-x`) is null, not a guess.
 */
export function modelVendor(model: string): ModelVendor | null {
  const parts = model.trim().toLowerCase().split('/').filter((p) => p !== '');
  if (parts.length === 0) return null;
  const name = parts[parts.length - 1]!;
  const byName = NAME_VENDOR.find(([re]) => re.test(name))?.[1] ?? null;
  const routed = new Set(parts.slice(0, -1).map((p) => ROUTE_VENDOR[p]).filter((v): v is ModelVendor => v !== undefined));
  if (routed.size > 1) return null;
  const byRoute = routed.size === 1 ? [...routed][0]! : null;
  if (byRoute !== null && byName !== null && byRoute !== byName) return null;
  return byName ?? byRoute;
}

/**
 * Refuses a composition whose three providers are not three different independence groups, whose models cannot all be mapped to a
 * vendor (FAILS CLOSED: 'role_model_vendor_unmapped'), or whose three models share a vendor.
 */
export function composeRoleProviders(providers: { readonly architect: RoleProvider; readonly coder: RoleProvider; readonly reviewer: RoleProvider }): typeof providers {
  const ids = [providers.architect.providerId, providers.coder.providerId, providers.reviewer.providerId];
  if (new Set(ids).size !== 3) throw new Error('role_providers_not_independent');
  if (new Set([providers.architect.fake, providers.coder.fake, providers.reviewer.fake]).size !== 1) throw new Error('role_providers_mixed_fake_and_real');
  // Independence is provider AND model vendor (review F3): a provider string alone can change without changing the model behind it.
  const vendors = [providers.architect.model, providers.coder.model, providers.reviewer.model].map(modelVendor);
  if (vendors.some((v) => v === null)) throw new Error('role_model_vendor_unmapped');
  if (new Set(vendors).size !== 3) throw new Error('role_models_not_independent_families');
  return providers;
}
