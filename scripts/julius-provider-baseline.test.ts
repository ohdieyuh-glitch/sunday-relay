import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The baseline is plain JavaScript so a runner can execute it without a build.
 * The scripts typecheck does not compile `.mjs`, so the test names the return
 * shape here instead of importing an untyped module.
 *
 * Fixture shapes:
 * - xAI usage request and `timeSeries` / `limitReached` response:
 *   https://docs.x.ai/developers/rest-api-reference/management/billing
 * - xAI prepaid balance `total.val` (USD cents as a decimal string): same page,
 *   GET /v1/billing/teams/{team_id}/prepaid/balance
 * - Anthropic cost_report `amount` is a decimal string in cents, and pages
 *   carry `has_more` / `next_page`:
 *   https://platform.claude.com/docs/en/api/admin/cost_report/retrieve
 */
interface ProviderBaselineRow {
  readonly timestamp: string;
  readonly provider: string;
  readonly status: string;
  readonly unknownReason: string | null;
  readonly organizationId: string | null;
  readonly projectIds: readonly string[] | null;
  readonly teamId: string | null;
  readonly cost: unknown;
  readonly usage: unknown;
  readonly sourceEndpoints: readonly string[];
  readonly balance: { readonly status: string; readonly reason: string | null; readonly totalCents: string | null };
}

const baseline = createRequire(import.meta.url)('./julius-provider-baseline.mjs') as {
  collectProviderBaseline: (input: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly fetchImpl: typeof fetch;
    readonly now?: () => string;
  }) => Promise<readonly ProviderBaselineRow[]>;
  main: (env: Record<string, string | undefined>, fetchImpl: typeof fetch, now: () => string) => Promise<number>;
  baselineCallJson: (input: {
    readonly fetchImpl: typeof fetch;
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly secrets: readonly string[];
  }) => Promise<unknown>;
  centsDecimalToUsd: (amountCents: string) => string | null;
  xaiUsageRequestBody: (start: number, end: number) => {
    readonly analyticsRequest: {
      readonly timeRange: { readonly startTime: string; readonly endTime: string; readonly timezone: string };
      readonly timeUnit: string;
      readonly values: readonly { readonly name: string; readonly aggregation: string }[];
    };
  };
  SPEND_MUTATION_PATHS: readonly string[];
};

const { collectProviderBaseline, main, baselineCallJson, centsDecimalToUsd, xaiUsageRequestBody, SPEND_MUTATION_PATHS } = baseline;

const OPENAI_KEY = 'sk-admin-FAKETESTNOTREAL';
const ANTHROPIC_KEY = 'sk-ant-FAKETESTNOTREAL';
const XAI_KEY = 'xai-mgmt-FAKETESTNOTREAL';
const NOW = () => '2026-10-23T00:00:00.000Z';

function headersOf(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

/**
 * Documented xAI usage response, shortened to one point.
 * https://docs.x.ai/developers/rest-api-reference/management/billing
 */
const XAI_USAGE_BODY = {
  timeSeries: [{
    group: ['Chat grok-4-0709'],
    dataPoints: [{ timestamp: '2026-10-22T00:00:00Z', values: [0.75973725] }],
  }],
  limitReached: false,
};

describe('provider baseline reads usage and cost, never a completion, and never a key', () => {
  it('records OpenAI, Anthropic, and xAI figures from documented fixture responses', async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      bodies.push(init?.body === undefined ? null : JSON.parse(String(init.body)));
      const auth = headersOf(init).get('authorization') ?? '';
      const apiKey = headersOf(init).get('x-api-key') ?? '';
      expect(url).not.toMatch(/\/v1\/chat\/completions|\/v1\/responses|\/v1\/messages$/u);
      if (url.includes('api.openai.com') && url.endsWith('/projects')) {
        expect(auth).toBe(`Bearer ${OPENAI_KEY}`);
        return jsonResponse(
          { data: [{ id: 'proj_recorded', object: 'organization.project' }] },
          { 'openai-organization': 'org_recorded' },
        );
      }
      if (url.includes('/organization/costs')) {
        return jsonResponse({
          data: [{ results: [{ amount: { value: 1.25, currency: 'usd' }, project_id: 'proj_recorded' }] }],
        });
      }
      if (url.includes('/organization/usage/completions')) {
        return jsonResponse({
          data: [{ results: [{ input_tokens: 10, output_tokens: 4, project_id: 'proj_recorded', model: 'gpt-5.6-sol' }] }],
        });
      }
      if (url.includes('/usage_report/messages')) {
        expect(apiKey).toBe(ANTHROPIC_KEY);
        return jsonResponse(
          {
            data: [{ results: [{ uncached_input_tokens: 8, output_tokens: 2, model: 'claude-opus-5-5' }] }],
            has_more: false,
            next_page: null,
          },
          { 'anthropic-organization-id': 'org_anthropic_recorded' },
        );
      }
      if (url.includes('/cost_report')) {
        return jsonResponse({
          data: [{ results: [{ amount: '123.45', currency: 'USD' }] }],
          has_more: false,
          next_page: null,
        });
      }
      if (url.includes('/prepaid/balance')) {
        expect(init?.method).toBe('GET');
        return jsonResponse({ changes: [], total: { val: '-1000' } });
      }
      if (url.includes('management-api.x.ai') && url.includes('/usage')) {
        expect(url).toContain('/v1/billing/teams/team_recorded/usage');
        expect(init?.method).toBe('POST');
        expect(auth).toBe(`Bearer ${XAI_KEY}`);
        return jsonResponse({
          ...XAI_USAGE_BODY,
          redacted_api_key: 'sk-should-not-be-copied',
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    const rows = await collectProviderBaseline({
      env: {
        OPENAI_ADMIN_KEY: OPENAI_KEY,
        ANTHROPIC_ADMIN_KEY: ANTHROPIC_KEY,
        XAI_MANAGEMENT_API_KEY: XAI_KEY,
        XAI_TEAM_ID: 'team_recorded',
      },
      fetchImpl,
      now: NOW,
    });
    const rendered = JSON.stringify(rows);
    expect(rendered).not.toContain(OPENAI_KEY);
    expect(rendered).not.toContain(ANTHROPIC_KEY);
    expect(rendered).not.toContain(XAI_KEY);
    expect(rendered).not.toContain('sk-should-not-be-copied');
    expect(rendered).not.toContain('authorization');

    const openai = rows.find((row) => row.provider === 'openai');
    expect(openai).toMatchObject({
      timestamp: '2026-10-23T00:00:00.000Z',
      organizationId: 'org_recorded',
      projectIds: ['proj_recorded'],
      status: 'REPORTED',
      balance: { status: 'UNKNOWN', reason: 'prepaid_balance_endpoint_not_documented' },
    });
    expect(openai?.cost).toEqual([{ amountValue: 1.25, currency: 'usd', projectId: 'proj_recorded' }]);
    expect(openai?.usage).toEqual([{ inputTokens: 10, outputTokens: 4, projectId: 'proj_recorded', model: 'gpt-5.6-sol' }]);
    expect(openai?.sourceEndpoints).toEqual([
      'https://api.openai.com/v1/organization/projects',
      'https://api.openai.com/v1/organization/costs',
      'https://api.openai.com/v1/organization/usage/completions',
    ]);

    const anthropic = rows.find((row) => row.provider === 'anthropic');
    expect(anthropic).toMatchObject({
      organizationId: 'org_anthropic_recorded',
      status: 'REPORTED',
      balance: { status: 'UNKNOWN', reason: 'prepaid_balance_endpoint_not_documented' },
    });
    expect(anthropic?.cost).toEqual([{ amountCents: '123.45', usd: '1.2345', currency: 'USD' }]);

    const xai = rows.find((row) => row.provider === 'xai');
    expect(xai).toMatchObject({
      teamId: 'team_recorded',
      status: 'REPORTED',
      balance: { status: 'REPORTED', reason: null, totalCents: '-1000' },
      usage: {
        limitReached: false,
        timeSeries: [{
          group: ['Chat grok-4-0709'],
          dataPoints: [{ timestamp: '2026-10-22T00:00:00Z', values: [0.75973725] }],
        }],
      },
    });
    expect(bodies).toContainEqual(xaiUsageRequestBody(
      Math.floor(Date.parse('2026-10-23T00:00:00.000Z') / 1000) - 86_400,
      Math.floor(Date.parse('2026-10-23T00:00:00.000Z') / 1000),
    ));
    expect(urls.some((url) => url.includes('/v1/chat/completions'))).toBe(false);
    expect(urls.some((url) => url.includes('/prepaid/top-up'))).toBe(false);
  });

  it('123.45 cents is 1.2345 dollars', () => {
    expect(centsDecimalToUsd('123.45')).toBe('1.2345');
    expect(centsDecimalToUsd('0.40')).toBe('0.0040');
    expect(centsDecimalToUsd('100')).toBe('1.00');
  });

  it('Anthropic has_more is followed, and a page that cannot continue is PARTIAL', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      if (url.includes('/usage_report/messages')) {
        return jsonResponse({ data: [], has_more: false, next_page: null }, { 'anthropic-organization-id': 'org_page' });
      }
      if (url.includes('/cost_report') && !url.includes('page=')) {
        return jsonResponse({
          data: [{ results: [{ amount: '100.00', currency: 'USD' }] }],
          has_more: true,
          next_page: 'page_2',
        });
      }
      if (url.includes('/cost_report') && url.includes('page=page_2')) {
        return jsonResponse({
          data: [{ results: [{ amount: '23.45', currency: 'USD' }] }],
          has_more: false,
          next_page: null,
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;
    const complete = await collectProviderBaseline({
      env: { ANTHROPIC_ADMIN_KEY: ANTHROPIC_KEY },
      fetchImpl,
      now: NOW,
    });
    const anthropic = complete.find((row) => row.provider === 'anthropic');
    expect(anthropic?.status).toBe('REPORTED');
    expect(anthropic?.cost).toEqual([
      { amountCents: '100.00', usd: '1.0000', currency: 'USD' },
      { amountCents: '23.45', usd: '0.2345', currency: 'USD' },
    ]);

    const stuck = await collectProviderBaseline({
      env: { ANTHROPIC_ADMIN_KEY: ANTHROPIC_KEY },
      fetchImpl: (async (url: string) => {
        if (url.includes('/usage_report/messages')) {
          return jsonResponse({ data: [], has_more: true, next_page: null }, { 'anthropic-organization-id': 'org_page' });
        }
        return jsonResponse({ data: [], has_more: false, next_page: null });
      }) as typeof fetch,
      now: NOW,
    });
    const partial = stuck.find((row) => row.provider === 'anthropic');
    expect(partial?.status).toBe('PARTIAL');
    expect(partial?.status).not.toBe('REPORTED');
    expect(partial?.unknownReason).toBe('has_more');
    expect(seen.some((url) => url.includes('page=page_2'))).toBe(true);
  });

  it('xAI limitReached is PARTIAL, and a balance body that is not the documented total stays UNVERIFIED', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('/usage')) return jsonResponse({ ...XAI_USAGE_BODY, limitReached: true });
      if (url.includes('/prepaid/balance')) return jsonResponse({ changes: [] });
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;
    const rows = await collectProviderBaseline({
      env: { XAI_MANAGEMENT_API_KEY: XAI_KEY, XAI_TEAM_ID: 'team_recorded' },
      fetchImpl,
      now: NOW,
    });
    const xai = rows.find((row) => row.provider === 'xai');
    expect(xai?.status).toBe('PARTIAL');
    expect(xai?.unknownReason).toBe('usage_limit_reached');
    expect(xai?.balance).toEqual({ status: 'UNVERIFIED', reason: 'prepaid_balance_unverified', totalCents: null });
  });

  it('a missing admin key is UNKNOWN and does not call the network', async () => {
    const fetchImpl = (() => { throw new Error('network'); }) as typeof fetch;
    const rows = await collectProviderBaseline({ env: {}, fetchImpl, now: NOW });
    expect(rows.map((row) => [row.provider, row.status, row.unknownReason])).toEqual([
      ['openai', 'UNKNOWN', 'admin_key_missing'],
      ['anthropic', 'UNKNOWN', 'admin_key_missing'],
      ['xai', 'UNKNOWN', 'management_key_missing'],
    ]);
    for (const row of rows) {
      expect(row.cost).toBeNull();
      expect(row.usage).toBeNull();
    }
    expect(rows.find((row) => row.provider === 'openai')?.balance.reason).toBe('prepaid_balance_endpoint_not_documented');
    expect(rows.find((row) => row.provider === 'anthropic')?.balance.reason).toBe('prepaid_balance_endpoint_not_documented');
    expect(rows.find((row) => row.provider === 'xai')?.balance).toEqual({
      status: 'UNVERIFIED', reason: 'prepaid_balance_unverified', totalCents: null,
    });
  });

  it('xAI without a team id does not invent one', async () => {
    const fetchImpl = (() => { throw new Error('network'); }) as typeof fetch;
    const rows = await collectProviderBaseline({
      env: { XAI_MANAGEMENT_API_KEY: XAI_KEY },
      fetchImpl,
      now: NOW,
    });
    const xai = rows.find((row) => row.provider === 'xai');
    expect(xai).toMatchObject({ status: 'UNKNOWN', unknownReason: 'team_id_missing', teamId: null });
  });

  it('refuses top-up, spending-limits, and payment-method before any fetch', async () => {
    expect(SPEND_MUTATION_PATHS).toEqual(['/prepaid/top-up', '/spending-limits', '/payment-method']);
    let called = false;
    const fetchImpl = (async () => { called = true; throw new Error('fetched'); }) as typeof fetch;
    for (const fragment of SPEND_MUTATION_PATHS) {
      await expect(baselineCallJson({
        fetchImpl,
        url: `https://management-api.x.ai/v1/billing/teams/team_recorded${fragment}`,
        method: 'POST',
        headers: {},
        secrets: [],
      })).rejects.toThrow('spend_mutation_endpoint_refused');
    }
    expect(called).toBe(false);
  });

  it('scrubs a key that a transport error echoes', async () => {
    const fetchImpl = (async () => {
      throw new Error(`socket closed while sending ${OPENAI_KEY}`);
    }) as typeof fetch;
    const rows = await collectProviderBaseline({
      env: { OPENAI_ADMIN_KEY: OPENAI_KEY },
      fetchImpl,
      now: NOW,
    });
    const rendered = JSON.stringify(rows);
    expect(rendered).not.toContain(OPENAI_KEY);
    expect(rendered).toContain('[redacted]');
    expect(rows.find((row) => row.provider === 'openai')?.unknownReason).toContain('request_failed:');
  });

  it('stdout scrub still redacts a secret that a copied field contains', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/projects')) {
        return jsonResponse({ data: [{ id: 'proj_recorded' }] }, { 'openai-organization': OPENAI_KEY });
      }
      if (url.includes('/organization/costs')) return jsonResponse({ data: [] });
      if (url.includes('/organization/usage/completions')) return jsonResponse({ data: [] });
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await main({ OPENAI_ADMIN_KEY: OPENAI_KEY }, fetchImpl, NOW);
    } finally {
      process.stdout.write = write;
    }
    const out = chunks.join('');
    expect(out).not.toContain(OPENAI_KEY);
    expect(out).toContain('[redacted]');
  });

  it('is not referenced by a workflow', () => {
    const workflows = readdirSync(join('.github', 'workflows'));
    for (const name of workflows) {
      const text = readFileSync(join('.github', 'workflows', name), 'utf8');
      expect(text, name).not.toContain('julius-provider-baseline');
    }
  });
});
