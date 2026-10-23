import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The baseline is plain JavaScript so a runner can execute it without a build.
 * The scripts typecheck does not compile `.mjs`, so the test names the return
 * shape here instead of importing an untyped module.
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
  readonly balance: { readonly status: string; readonly reason: string };
}

const { collectProviderBaseline } = createRequire(import.meta.url)('./julius-provider-baseline.mjs') as {
  collectProviderBaseline: (input: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly fetchImpl: typeof fetch;
    readonly now?: () => string;
  }) => Promise<readonly ProviderBaselineRow[]>;
};

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

describe('provider baseline reads usage and cost, never a completion, and never a key', () => {
  it('records OpenAI, Anthropic, and xAI figures from fixture responses and leaves prepaid balance UNKNOWN', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
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
          { data: [{ results: [{ uncached_input_tokens: 8, output_tokens: 2, model: 'claude-opus-5-5' }] }] },
          { 'anthropic-organization-id': 'org_anthropic_recorded' },
        );
      }
      if (url.includes('/cost_report')) {
        return jsonResponse({ data: [{ results: [{ amount: '0.40', currency: 'USD' }] }] });
      }
      if (url.includes('management-api.x.ai')) {
        expect(url).toContain('/v1/billing/teams/team_recorded/usage');
        expect(auth).toBe(`Bearer ${XAI_KEY}`);
        return jsonResponse({
          team_id: 'team_recorded', input_tokens: 3, output_tokens: 1, amount: '0.02', currency: 'USD',
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
    expect(anthropic?.cost).toEqual([{ amount: '0.40', currency: 'USD' }]);

    const xai = rows.find((row) => row.provider === 'xai');
    expect(xai).toMatchObject({
      teamId: 'team_recorded',
      status: 'REPORTED',
      balance: { status: 'UNKNOWN', reason: 'prepaid_balance_endpoint_not_documented' },
    });
    expect(urls.some((url) => url.includes('/v1/chat/completions'))).toBe(false);
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
      expect(row.balance.reason).toBe('prepaid_balance_endpoint_not_documented');
    }
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

  it('is not referenced by a workflow', () => {
    const workflows = readdirSync(join('.github', 'workflows'));
    for (const name of workflows) {
      const text = readFileSync(join('.github', 'workflows', name), 'utf8');
      expect(text, name).not.toContain('julius-provider-baseline');
    }
  });
});
