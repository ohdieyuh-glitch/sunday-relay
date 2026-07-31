import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MILESTONE 5 boundary tests — the mechanical proof that the economics domain
 * touches no provider, no billing API, no payment processor, no network, no
 * database, no environment, and no clock.
 *
 * Repo convention: source-level assertions, matching the Milestone 2/3/4
 * domain boundary tests.
 */

const dir = join(process.cwd(), 'src', 'relay', 'mission', 'economics');
const sources = readdirSync(dir)
  .filter((name) => /\.ts$/u.test(name) && !/\.test\.ts$/u.test(name))
  .map((name) => join(dir, name));
const read = (file: string) => readFileSync(file, 'utf8');

const FORBIDDEN: Array<[RegExp, string]> = [
  [/from\s+['"]node:/u, 'node builtins (the domain must stay browser-safe)'],
  [/from\s+['"]react/u, 'React'],
  [/from\s+['"]zustand/u, 'zustand'],
  [/from\s+['"]openai['"]|from\s+['"]@anthropic/u, 'provider SDKs'],
  [/from\s+['"]stripe|from\s+['"]@stripe/iu, 'payment processors'],
  [/from\s+['"].*connectors\//u, 'agent connectors'],
  [/from\s+['"].*relay-bridge/u, 'the relay bridge'],
  [/from\s+['"].*fusion-engine/u, 'the Fusion Engine'],
  [/\bfetch\s*\(/u, 'network fetch'],
  [/XMLHttpRequest|WebSocket|EventSource/u, 'network transports'],
  [/child_process|execSync|spawnSync/u, 'shell processes'],
  [/process\.env/u, 'environment variables'],
  [/Date\.now\(|new Date\(\)/u, 'ambient clocks (timestamps are caller-supplied)'],
  [/Math\.random\(/u, 'non-determinism'],
  [/localStorage|sessionStorage|indexedDB/u, 'browser storage'],
  [/createClient|supabase/iu, 'database clients'],
];

/** The ONLY modules the economics domain may reach outside its directory. */
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  '../status/status-model',
  '../commands/command-events',
  '../trace/trace-types',
]);

/** Names that would mean economics is calling out to money infrastructure. */
const FORBIDDEN_CALLS =
  /billingApi|chargeCard|createCharge|createPaymentIntent|fetchPricing|lookupPrice|refundPayment|capturePayment/u;

describe('mission economics domain boundary', () => {
  it('finds the economics sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(10);
  });

  it('never reaches providers, billing, payments, network, storage, clocks, or env', () => {
    for (const file of sources) {
      const content = read(file);
      for (const [pattern, why] of FORBIDDEN) {
        expect(pattern.test(content), `${file} must not reference ${why}`).toBe(false);
      }
    }
  });

  it('never calls a billing, pricing, or payment API', () => {
    for (const file of sources) {
      expect(FORBIDDEN_CALLS.test(read(file)), `${file} must not call money infrastructure`).toBe(
        false,
      );
    }
  });

  it('imports stay inside the domain plus the sanctioned mission modules', () => {
    for (const file of sources) {
      const content = read(file);
      // Only real import/export-from statements — never the word "from" in prose.
      for (const match of content.matchAll(/^\s*(?:import|export)[^;]*?\bfrom\s+['"]([^'"]+)['"]/gmu)) {
        const specifier = match[1];
        const allowed = specifier.startsWith('./') || ALLOWED_EXTERNAL_IMPORTS.has(specifier);
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it('money is never a float: no parseFloat, no Number() on an amount, no toFixed', () => {
    const money = read(join(dir, 'money.ts'));
    expect(/parseFloat\(/u.test(money)).toBe(false);
    expect(/\.toFixed\(/u.test(money)).toBe(false);
    // BigInt is used for arithmetic, but the STORED type is a string.
    expect(/amountMicros:\s*string/u.test(money)).toBe(true);
    expect(/amountMicros:\s*(number|bigint)/u.test(money)).toBe(false);
  });

  it('no stored domain record types money as a number or BigInt', () => {
    for (const file of sources) {
      const content = read(file);
      expect(/amountMicros\??:\s*number/u.test(content), `${file}`).toBe(false);
      expect(/amountMicros\??:\s*bigint/u.test(content), `${file}`).toBe(false);
    }
  });

  it('the in-memory repository is explicitly labeled non-production', () => {
    const repository = read(join(dir, 'cost-receipt-repository.ts'));
    expect(repository).toMatch(/NOT a database and NOT\s*\n?\s*\*?\s*production persistence/u);
    expect(/\bdelete\s*\(|removeReceipt|purge/u.test(repository)).toBe(false);
  });

  it('no module hardcodes a provider price as product truth', () => {
    for (const file of sources) {
      const content = read(file);
      // A rate must be a REFERENCE with a trust level, never a literal table.
      expect(/PROVIDER_PRICES|PRICE_TABLE|PRICING_CATALOG/u.test(content), file).toBe(false);
    }
    // Comment continuations are unwrapped before matching.
    const types = read(join(dir, 'cost-receipt-types.ts')).replace(/\s*\n\s*\*\s*/gu, ' ');
    expect(types).toMatch(/no live pricing lookup and no billing API call/u);
  });

  it('fixtures declare themselves fictional and development-only', () => {
    const fixtures = read(join(dir, 'economics-fixtures.ts'));
    expect(fixtures).toMatch(/test\/development data ONLY/u);
    expect(fixtures).toMatch(/FICTIONAL/u);
    expect(fixtures).toMatch(/development_fixture/u);
  });

  it('the projection never fabricates a zero for a missing amount', () => {
    const projection = read(join(dir, 'economics-projection.ts'));
    expect(projection).toMatch(/NEVER render/iu);
    // Every missing branch resolves to a word, not a formatted amount.
    expect(/UNKNOWN_LABEL|NOT_AVAILABLE_LABEL|PENDING_LABEL|NOT_CONFIGURED_LABEL/u.test(projection)).toBe(
      true,
    );
  });
});
