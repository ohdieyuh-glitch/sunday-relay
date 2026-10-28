#!/usr/bin/env node
/**
 * SPEND-FREE PROVIDER BASELINE.
 *
 * Reads admin or management keys from the environment at call time and queries
 * official organization usage and cost endpoints. It does not call a model
 * completion endpoint, and it is not referenced by any workflow.
 *
 * xAI usage is the documented Management API:
 * POST /v1/billing/teams/{team_id}/usage
 * https://docs.x.ai/developers/rest-api-reference/management/billing
 * The prepaid balance read is also documented there
 * (GET /v1/billing/teams/{team_id}/prepaid/balance). A body that is not that
 * response stays UNVERIFIED. It is never treated as a verified zero.
 *
 * Management and admin keys can spend. This script refuses top-up,
 * spending-limits, and payment-method paths before any fetch. It is not a
 * least-privilege key. Do not wire it into a job until the founder chooses one.
 *
 * A missing key or an unreadable response is UNKNOWN, never zero. Anthropic
 * `cost_report` amounts are decimal strings in cents
 * (https://platform.claude.com/docs/en/api/admin/cost_report/retrieve).
 * `has_more` is followed via `next_page` as the `page` parameter. A report
 * that does not attest `has_more: false` is PARTIAL, never REPORTED.
 * Organization and project ids are copied only from non-secret response
 * fields or the one documented organization header. Request headers that
 * carry a key are never copied into the result, and any secret value is
 * scrubbed from error text before it is recorded and again on stdout.
 */

const OPENAI_COSTS = 'https://api.openai.com/v1/organization/costs';
const OPENAI_USAGE = 'https://api.openai.com/v1/organization/usage/completions';
const OPENAI_PROJECTS = 'https://api.openai.com/v1/organization/projects';
const ANTHROPIC_USAGE = 'https://api.anthropic.com/v1/organizations/usage_report/messages';
const ANTHROPIC_COSTS = 'https://api.anthropic.com/v1/organizations/cost_report';
const XAI_MANAGEMENT = 'https://management-api.x.ai';
const ANTHROPIC_PAGE_CAP = 8;

const COMPLETION_PATHS = ['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1/complete'];

/** Paths that move money or change how money moves. A baseline read must not call them. */
export const SPEND_MUTATION_PATHS = Object.freeze([
  '/prepaid/top-up',
  '/spending-limits',
  '/payment-method',
]);

export const BASELINE_ENV = Object.freeze({
  openaiAdminKey: 'OPENAI_ADMIN_KEY',
  anthropicAdminKey: 'ANTHROPIC_ADMIN_KEY',
  xaiManagementKey: 'XAI_MANAGEMENT_API_KEY',
  xaiTeamId: 'XAI_TEAM_ID',
});

function scrub(text, secrets) {
  let out = typeof text === 'string' ? text : '';
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function header(response, name) {
  const headers = response?.headers;
  if (headers === null || headers === undefined || typeof headers.get !== 'function') return null;
  const value = headers.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function assertNotCompletion(url) {
  const path = new URL(url).pathname;
  if (COMPLETION_PATHS.includes(path)) {
    throw new Error('completion_endpoint_refused');
  }
}

function assertNotSpendMutation(url) {
  const path = new URL(url).pathname;
  if (SPEND_MUTATION_PATHS.some((fragment) => path.includes(fragment))) {
    throw new Error('spend_mutation_endpoint_refused');
  }
}

async function readJson(response) {
  if (typeof response.json === 'function') return response.json();
  if (typeof response.text === 'function') return JSON.parse(await response.text());
  return null;
}

/**
 * One bounded GET or POST. The key travels only on this request. The returned
 * error text is scrubbed. Non-2xx is UNKNOWN with the status, not a parsed bill.
 */
export async function baselineCallJson({ fetchImpl, url, method, headers, body, secrets }) {
  assertNotCompletion(url);
  assertNotSpendMutation(url);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      json: null,
      organizationHeader: null,
      reason: `request_failed:${scrub(error instanceof Error ? error.message : 'error', secrets)}`,
    };
  }
  const status = typeof response?.status === 'number' ? response.status : null;
  const organizationHeader = header(response, 'openai-organization') ?? header(response, 'anthropic-organization-id');
  if (status === null || status < 200 || status >= 300) {
    return { ok: false, status, json: null, organizationHeader, reason: `http_${String(status ?? 'none')}` };
  }
  try {
    return { ok: true, status, json: await readJson(response), organizationHeader, reason: null };
  } catch (error) {
    return {
      ok: false,
      status,
      json: null,
      organizationHeader,
      reason: `unreadable_body:${scrub(error instanceof Error ? error.message : 'error', secrets)}`,
    };
  }
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Cents, as a decimal string, to dollars, as a decimal string.
 * "123.45" cents is "1.2345" dollars. No binary float.
 */
export function centsDecimalToUsd(amountCents) {
  if (typeof amountCents !== 'string' || !/^-?\d+(\.\d+)?$/u.test(amountCents)) return null;
  const negative = amountCents.startsWith('-');
  const body = negative ? amountCents.slice(1) : amountCents;
  const [whole, frac = ''] = body.split('.');
  const digits = `${whole}${frac}`;
  const scale = frac.length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const cut = padded.length - scale;
  const usd = `${padded.slice(0, cut)}.${padded.slice(cut)}`;
  return negative ? `-${usd}` : usd;
}

function buckets(json) {
  return json !== null && typeof json === 'object' && Array.isArray(json.data) ? json.data : [];
}

function openaiCosts(json) {
  const rows = [];
  for (const bucket of buckets(json)) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      rows.push({
        amountValue: numberOrNull(result?.amount?.value) ?? stringOrNull(result?.amount?.value),
        currency: stringOrNull(result?.amount?.currency),
        projectId: stringOrNull(result?.project_id),
      });
    }
  }
  return rows;
}

function openaiUsage(json) {
  const rows = [];
  for (const bucket of buckets(json)) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      rows.push({
        inputTokens: numberOrNull(result?.input_tokens),
        outputTokens: numberOrNull(result?.output_tokens),
        projectId: stringOrNull(result?.project_id),
        model: stringOrNull(result?.model),
      });
    }
  }
  return rows;
}

function openaiProjects(json) {
  const data = json !== null && typeof json === 'object' && Array.isArray(json.data) ? json.data : [];
  return data.map((project) => stringOrNull(project?.id)).filter((id) => id !== null);
}

function anthropicCosts(json) {
  const rows = [];
  for (const bucket of buckets(json)) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      const amountCents = stringOrNull(result?.amount);
      rows.push({
        amountCents,
        usd: centsDecimalToUsd(amountCents),
        currency: stringOrNull(result?.currency),
      });
    }
  }
  return rows;
}

function anthropicUsage(json) {
  const rows = [];
  for (const bucket of buckets(json)) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      rows.push({
        uncachedInputTokens: numberOrNull(result?.uncached_input_tokens),
        outputTokens: numberOrNull(result?.output_tokens),
        model: stringOrNull(result?.model),
      });
    }
  }
  return rows;
}

function withPage(url, page) {
  const next = new URL(url);
  next.searchParams.set('page', page);
  return next.toString();
}

/**
 * Follow `next_page` while `has_more` is true. Missing `has_more: false`,
 * a missing cursor, or the page cap is PARTIAL — the report is not complete.
 */
async function readAnthropicReport(url, headers, secrets, fetchImpl) {
  const pages = [];
  let current = url;
  let organizationHeader = null;
  for (let i = 0; i < ANTHROPIC_PAGE_CAP; i += 1) {
    const page = await baselineCallJson({ fetchImpl, url: current, method: 'GET', headers, secrets });
    if (!page.ok) {
      return {
        ok: false, partial: false, pages, organizationHeader: page.organizationHeader ?? organizationHeader, reason: page.reason,
      };
    }
    organizationHeader = page.organizationHeader ?? organizationHeader;
    pages.push(page.json);
    const body = page.json !== null && typeof page.json === 'object' ? page.json : null;
    const nextPage = body === null ? null : stringOrNull(body.next_page);
    if (body?.has_more === false) {
      return { ok: true, partial: false, pages, organizationHeader, reason: null };
    }
    if (nextPage === null) {
      return { ok: true, partial: true, pages, organizationHeader, reason: 'has_more' };
    }
    current = withPage(current, nextPage);
  }
  return { ok: true, partial: true, pages, organizationHeader, reason: 'has_more' };
}

function xaiStamp(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** Documented analytics body. USD sum, daily buckets, Etc/GMT. */
export function xaiUsageRequestBody(startEpochSeconds, endEpochSeconds) {
  return {
    analyticsRequest: {
      timeRange: {
        startTime: xaiStamp(startEpochSeconds),
        endTime: xaiStamp(endEpochSeconds),
        timezone: 'Etc/GMT',
      },
      timeUnit: 'TIME_UNIT_DAY',
      values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
    },
  };
}

function xaiUsage(json) {
  if (json === null || typeof json !== 'object' || !Array.isArray(json.timeSeries)) return null;
  const limitReached = json.limitReached === true ? true : json.limitReached === false ? false : null;
  const timeSeries = json.timeSeries.map((series) => {
    const group = Array.isArray(series?.group) ? series.group.filter((item) => typeof item === 'string') : [];
    const points = Array.isArray(series?.dataPoints) ? series.dataPoints : [];
    const dataPoints = [];
    for (const point of points) {
      const timestamp = stringOrNull(point?.timestamp);
      const values = Array.isArray(point?.values)
        ? point.values.filter((value) => typeof value === 'number' && Number.isFinite(value))
        : [];
      if (timestamp !== null) dataPoints.push({ timestamp, values });
    }
    return { group, dataPoints };
  });
  return { timeSeries, limitReached };
}

function unknownBalance() {
  return { status: 'UNKNOWN', reason: 'prepaid_balance_endpoint_not_documented', totalCents: null };
}

function unverifiedXaiBalance() {
  return { status: 'UNVERIFIED', reason: 'prepaid_balance_unverified', totalCents: null };
}

function xaiBalance(call) {
  if (!call.ok || call.json === null || typeof call.json !== 'object') return unverifiedXaiBalance();
  const val = call.json.total?.val;
  if (typeof val !== 'string' || !/^-?\d+(\.\d+)?$/u.test(val)) return unverifiedXaiBalance();
  return { status: 'REPORTED', reason: null, totalCents: val };
}

function record(partial) {
  return {
    timestamp: partial.timestamp,
    provider: partial.provider,
    organizationId: partial.organizationId ?? null,
    projectIds: partial.projectIds ?? [],
    teamId: partial.teamId ?? null,
    usage: partial.usage ?? null,
    cost: partial.cost ?? null,
    balance: partial.balance ?? unknownBalance(),
    sourceEndpoints: partial.sourceEndpoints ?? [],
    status: partial.status,
    unknownReason: partial.unknownReason ?? null,
  };
}

/**
 * @param {{ env: Record<string, string | undefined>, fetchImpl: typeof fetch, now?: () => string }} input
 */
export async function collectProviderBaseline(input) {
  const env = input.env ?? {};
  const fetchImpl = input.fetchImpl;
  const nowIso = (input.now ?? (() => new Date().toISOString()))();
  const nowMs = Date.parse(nowIso);
  const end = Number.isFinite(nowMs) ? Math.floor(nowMs / 1000) : 0;
  const start = end - 86_400;
  const secrets = [
    env[BASELINE_ENV.openaiAdminKey],
    env[BASELINE_ENV.anthropicAdminKey],
    env[BASELINE_ENV.xaiManagementKey],
  ];
  const rows = [];

  const openaiKey = env[BASELINE_ENV.openaiAdminKey];
  if (!openaiKey) {
    rows.push(record({
      timestamp: nowIso, provider: 'openai', status: 'UNKNOWN', unknownReason: 'admin_key_missing',
    }));
  } else {
    const headers = { authorization: `Bearer ${openaiKey}`, accept: 'application/json' };
    const projects = await baselineCallJson({ fetchImpl, url: OPENAI_PROJECTS, method: 'GET', headers, secrets });
    const costs = await baselineCallJson({
      fetchImpl, method: 'GET', headers, secrets,
      url: `${OPENAI_COSTS}?start_time=${String(start)}&end_time=${String(end)}&limit=7`,
    });
    const usage = await baselineCallJson({
      fetchImpl, method: 'GET', headers, secrets,
      url: `${OPENAI_USAGE}?start_time=${String(start)}&end_time=${String(end)}&bucket_width=1d&limit=7`,
    });
    const failed = [projects, costs, usage].find((item) => !item.ok);
    const organizationId = projects.organizationHeader ?? costs.organizationHeader ?? usage.organizationHeader;
    rows.push(record({
      timestamp: nowIso,
      provider: 'openai',
      organizationId,
      projectIds: projects.ok ? openaiProjects(projects.json) : [],
      usage: usage.ok ? openaiUsage(usage.json) : null,
      cost: costs.ok ? openaiCosts(costs.json) : null,
      sourceEndpoints: [OPENAI_PROJECTS, OPENAI_COSTS, OPENAI_USAGE],
      status: failed || organizationId === null ? 'UNKNOWN' : 'REPORTED',
      unknownReason: failed?.reason ?? (organizationId === null ? 'organization_id_not_in_response' : null),
    }));
  }

  const anthropicKey = env[BASELINE_ENV.anthropicAdminKey];
  if (!anthropicKey) {
    rows.push(record({
      timestamp: nowIso, provider: 'anthropic', status: 'UNKNOWN', unknownReason: 'admin_key_missing',
    }));
  } else {
    const starting = new Date(start * 1000).toISOString();
    const ending = new Date(end * 1000).toISOString();
    const headers = {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      accept: 'application/json',
    };
    const usage = await readAnthropicReport(
      `${ANTHROPIC_USAGE}?starting_at=${encodeURIComponent(starting)}&ending_at=${encodeURIComponent(ending)}&bucket_width=1d`,
      headers, secrets, fetchImpl,
    );
    const costs = await readAnthropicReport(
      `${ANTHROPIC_COSTS}?starting_at=${encodeURIComponent(starting)}&ending_at=${encodeURIComponent(ending)}&bucket_width=1d`,
      headers, secrets, fetchImpl,
    );
    const failed = [usage, costs].find((item) => !item.ok);
    const partial = usage.partial || costs.partial;
    const organizationId = usage.organizationHeader ?? costs.organizationHeader;
    const usageRows = usage.pages.flatMap((page) => anthropicUsage(page));
    const costRows = costs.pages.flatMap((page) => anthropicCosts(page));
    let status = 'REPORTED';
    let unknownReason = null;
    if (failed) {
      status = 'UNKNOWN';
      unknownReason = failed.reason;
    } else if (partial) {
      status = 'PARTIAL';
      unknownReason = 'has_more';
    } else if (organizationId === null) {
      status = 'UNKNOWN';
      unknownReason = 'organization_id_not_in_response';
    }
    rows.push(record({
      timestamp: nowIso,
      provider: 'anthropic',
      organizationId,
      usage: failed ? null : usageRows,
      cost: failed ? null : costRows,
      sourceEndpoints: [ANTHROPIC_USAGE, ANTHROPIC_COSTS],
      status,
      unknownReason,
    }));
  }

  const xaiKey = env[BASELINE_ENV.xaiManagementKey];
  const xaiTeam = env[BASELINE_ENV.xaiTeamId];
  if (!xaiKey) {
    rows.push(record({
      timestamp: nowIso, provider: 'xai', status: 'UNKNOWN', unknownReason: 'management_key_missing',
      balance: unverifiedXaiBalance(),
    }));
  } else if (!xaiTeam) {
    rows.push(record({
      timestamp: nowIso, provider: 'xai', status: 'UNKNOWN', unknownReason: 'team_id_missing', teamId: null,
      balance: unverifiedXaiBalance(),
    }));
  } else {
    const usageUrl = `${XAI_MANAGEMENT}/v1/billing/teams/${encodeURIComponent(xaiTeam)}/usage`;
    const balanceUrl = `${XAI_MANAGEMENT}/v1/billing/teams/${encodeURIComponent(xaiTeam)}/prepaid/balance`;
    const usage = await baselineCallJson({
      fetchImpl, url: usageUrl, method: 'POST', secrets,
      headers: { authorization: `Bearer ${xaiKey}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(xaiUsageRequestBody(start, end)),
    });
    const balanceCall = await baselineCallJson({
      fetchImpl, url: balanceUrl, method: 'GET', secrets,
      headers: { authorization: `Bearer ${xaiKey}`, accept: 'application/json' },
    });
    const picked = usage.ok ? xaiUsage(usage.json) : null;
    let status = 'UNKNOWN';
    let unknownReason = usage.reason;
    if (usage.ok && picked === null) unknownReason = 'usage_unreadable';
    if (usage.ok && picked !== null && picked.limitReached === null) unknownReason = 'limit_reached_absent';
    if (usage.ok && picked !== null && picked.limitReached === true) {
      status = 'PARTIAL';
      unknownReason = 'usage_limit_reached';
    }
    if (usage.ok && picked !== null && picked.limitReached === false) {
      status = 'REPORTED';
      unknownReason = null;
    }
    rows.push(record({
      timestamp: nowIso,
      provider: 'xai',
      teamId: xaiTeam,
      usage: picked,
      balance: xaiBalance(balanceCall),
      sourceEndpoints: [usageUrl, balanceUrl],
      status,
      unknownReason,
    }));
  }

  return rows;
}

export async function main(env = process.env, fetchImpl = globalThis.fetch, now) {
  const rows = await collectProviderBaseline({ env, fetchImpl, now });
  const secrets = [env[BASELINE_ENV.openaiAdminKey], env[BASELINE_ENV.anthropicAdminKey], env[BASELINE_ENV.xaiManagementKey]];
  process.stdout.write(`${scrub(JSON.stringify(rows), secrets)}\n`);
  return rows.some((row) => row.status !== 'REPORTED') ? 1 : 0;
}

if (process.argv[1] && fileIsMain(process.argv[1])) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write('provider_baseline_failed\n');
    process.exitCode = 1;
    void error;
  });
}

function fileIsMain(argv1) {
  return argv1.endsWith('julius-provider-baseline.mjs') || argv1.endsWith('julius-provider-baseline.cjs');
}
