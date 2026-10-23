#!/usr/bin/env node
/**
 * SPEND-FREE PROVIDER BASELINE.
 *
 * Reads admin or management keys from the environment at call time and queries
 * official organization usage and cost endpoints. It does not call a model
 * completion endpoint, and it is not referenced by any workflow.
 *
 * A provider with no documented prepaid-balance endpoint reports balance
 * UNKNOWN and the reason. A missing key or an unreadable response is UNKNOWN,
 * never zero. Organization and project ids are copied only from non-secret
 * response fields or the one documented organization header. Request headers
 * that carry a key are never copied into the result, and any secret value is
 * scrubbed from error text before it is recorded.
 */

const OPENAI_COSTS = 'https://api.openai.com/v1/organization/costs';
const OPENAI_USAGE = 'https://api.openai.com/v1/organization/usage/completions';
const OPENAI_PROJECTS = 'https://api.openai.com/v1/organization/projects';
const ANTHROPIC_USAGE = 'https://api.anthropic.com/v1/organizations/usage_report/messages';
const ANTHROPIC_COSTS = 'https://api.anthropic.com/v1/organizations/cost_report';
const XAI_MANAGEMENT = 'https://management-api.x.ai';

const COMPLETION_PATHS = ['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1/complete'];

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

async function readJson(response) {
  if (typeof response.json === 'function') return response.json();
  if (typeof response.text === 'function') return JSON.parse(await response.text());
  return null;
}

/**
 * One bounded GET or POST. The key travels only on this request. The returned
 * error text is scrubbed. Non-2xx is UNKNOWN with the status, not a parsed bill.
 */
async function callJson({ fetchImpl, url, method, headers, body, secrets }) {
  assertNotCompletion(url);
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
      rows.push({
        amount: stringOrNull(result?.amount) ?? numberOrNull(result?.amount),
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

function xaiUsage(json) {
  if (json === null || typeof json !== 'object') return null;
  return {
    teamId: stringOrNull(json.team_id),
    inputTokens: numberOrNull(json.input_tokens),
    outputTokens: numberOrNull(json.output_tokens),
    amount: stringOrNull(json.amount) ?? numberOrNull(json.amount),
    currency: stringOrNull(json.currency),
  };
}

function unknownBalance() {
  return { status: 'UNKNOWN', reason: 'prepaid_balance_endpoint_not_documented' };
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
    const projects = await callJson({ fetchImpl, url: OPENAI_PROJECTS, method: 'GET', headers, secrets });
    const costs = await callJson({
      fetchImpl, method: 'GET', headers, secrets,
      url: `${OPENAI_COSTS}?start_time=${String(start)}&end_time=${String(end)}&limit=7`,
    });
    const usage = await callJson({
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
    const usage = await callJson({
      fetchImpl, method: 'GET', headers, secrets,
      url: `${ANTHROPIC_USAGE}?starting_at=${encodeURIComponent(starting)}&ending_at=${encodeURIComponent(ending)}&bucket_width=1d`,
    });
    const costs = await callJson({
      fetchImpl, method: 'GET', headers, secrets,
      url: `${ANTHROPIC_COSTS}?starting_at=${encodeURIComponent(starting)}&ending_at=${encodeURIComponent(ending)}&bucket_width=1d`,
    });
    const failed = [usage, costs].find((item) => !item.ok);
    const organizationId = usage.organizationHeader ?? costs.organizationHeader;
    rows.push(record({
      timestamp: nowIso,
      provider: 'anthropic',
      organizationId,
      usage: usage.ok ? anthropicUsage(usage.json) : null,
      cost: costs.ok ? anthropicCosts(costs.json) : null,
      sourceEndpoints: [ANTHROPIC_USAGE, ANTHROPIC_COSTS],
      status: failed || organizationId === null ? 'UNKNOWN' : 'REPORTED',
      unknownReason: failed?.reason ?? (organizationId === null ? 'organization_id_not_in_response' : null),
    }));
  }

  const xaiKey = env[BASELINE_ENV.xaiManagementKey];
  const xaiTeam = env[BASELINE_ENV.xaiTeamId];
  if (!xaiKey) {
    rows.push(record({
      timestamp: nowIso, provider: 'xai', status: 'UNKNOWN', unknownReason: 'management_key_missing',
    }));
  } else if (!xaiTeam) {
    rows.push(record({
      timestamp: nowIso, provider: 'xai', status: 'UNKNOWN', unknownReason: 'team_id_missing',
    }));
  } else {
    const url = `${XAI_MANAGEMENT}/v1/billing/teams/${encodeURIComponent(xaiTeam)}/usage`;
    const usage = await callJson({
      fetchImpl, url, method: 'POST', secrets,
      headers: { authorization: `Bearer ${xaiKey}`, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ start_time: new Date(start * 1000).toISOString(), end_time: new Date(end * 1000).toISOString() }),
    });
    const picked = usage.ok ? xaiUsage(usage.json) : null;
    const teamId = picked?.teamId ?? null;
    rows.push(record({
      timestamp: nowIso,
      provider: 'xai',
      teamId,
      usage: picked,
      sourceEndpoints: [url],
      status: usage.ok && teamId !== null ? 'REPORTED' : 'UNKNOWN',
      unknownReason: !usage.ok ? usage.reason : teamId === null ? 'team_id_not_in_response' : null,
    }));
  }

  return rows;
}

export async function main(env = process.env, fetchImpl = globalThis.fetch, now) {
  const rows = await collectProviderBaseline({ env, fetchImpl, now });
  const secrets = [env[BASELINE_ENV.openaiAdminKey], env[BASELINE_ENV.anthropicAdminKey], env[BASELINE_ENV.xaiManagementKey]];
  process.stdout.write(`${scrub(JSON.stringify(rows), secrets)}\n`);
  return rows.some((row) => row.status === 'UNKNOWN') ? 1 : 0;
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
