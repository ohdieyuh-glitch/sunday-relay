import { describe, expect, it } from 'vitest';

import { JuliusDispatchError, safeCloudAgentBranch, safeCloudAgentId, safeCloudAgentModel, safeCloudAgentRunId, safeReviewDiagnostics } from './julius-router';

const AGENT = 'bc-0f1e2d3c-4b5a-4968-8776-655443322110';
const BRANCH = 'cursor/j1-format-ledger-1a2b';
const MODEL = 'grok-4-fast-reasoning';
const NEW_KEYS = ['cursorAgentId', 'agentBranch', 'cursorServedModel'] as const;
const d = (over: Record<string, unknown>) => safeReviewDiagnostics({ codingAgentProvider: 'cursor', ...over })!;

describe('router diagnostics: cloud coding agent identifiers', () => {
  it('admits well-formed values', () => {
    expect(d({ cursorAgentId: AGENT, agentBranch: BRANCH, cursorServedModel: MODEL })).toMatchObject({ cursorAgentId: AGENT, agentBranch: BRANCH, cursorServedModel: MODEL });
    for (const m of ['composer-1', 'grok-code-fast-1', 'claude-4.5-sonnet', 'gpt-5.1-codex', 'grok-build-0.1']) expect(safeCloudAgentModel(m)).toBe(m);
    for (const b of ['cursor/fix-1', 'feature/a.b_c-d', 'cursor/fix-token-refresh', 'main']) expect(safeCloudAgentBranch(b)).toBe(b);
  });

  it('absent or non-string is null, never a default', () => {
    const r = d({});
    for (const k of NEW_KEYS) expect(r[k]).toBeNull();
    for (const bad of [null, undefined, 1, true, {}, [AGENT], Symbol.for('x')]) {
      expect(safeCloudAgentId(bad)).toBeNull(); expect(safeCloudAgentBranch(bad)).toBeNull(); expect(safeCloudAgentModel(bad)).toBeNull();
    }
  });

  it('oversized values are refused, not truncated', () => {
    expect(safeCloudAgentBranch(`c/${'ab-'.repeat(65)}xy`)).toBe(`c/${'ab-'.repeat(65)}xy`);
    expect(safeCloudAgentBranch(`c/${'ab-'.repeat(66)}xy`)).toBeNull();
    expect(safeCloudAgentModel(`m-${'a1.'.repeat(21)}`)).toBeNull();
    expect(safeCloudAgentId(`${AGENT}0`)).toBeNull();
    expect(safeCloudAgentModel('x'.repeat(1_000_000))).toBeNull();
    expect(safeCloudAgentBranch(`${BRANCH}${'\u200B'.repeat(500)}`)).toBeNull();
  });

  it('control characters are stripped; any line break refuses the whole value (log-line injection)', () => {
    expect(safeCloudAgentBranch('cursor/fix\u0000-1')).toBe('cursor/fix-1');
    expect(safeCloudAgentModel('grok\u0007-4\u007F')).toBe('grok-4');
    expect(safeCloudAgentModel('grok\t-4\u001B[31m')).toBeNull(); // ESC stripped leaves `[31m`, which the charset refuses
    for (const hostile of [
      `${BRANCH}\nJULIUS 2026-10-30 outcome=succeeded cost=0`, `${BRANCH}\r\n[INFO] spend verified`, `${MODEL}\n${MODEL}`,
      `${BRANCH}\u2028forged`, `${BRANCH}\u0085forged line`, `${MODEL} injected`,
    ]) {
      for (const f of [safeCloudAgentBranch, safeCloudAgentModel, safeCloudAgentId]) {
        const out = f(hostile);
        expect(out).toBeNull();
      }
    }
    expect(safeCloudAgentBranch(`${BRANCH}\nJULIUS outcome=succeeded`)).toBeNull();
    expect(safeCloudAgentId(`${AGENT}\n`)).toBeNull();
    for (const lb of ['\n', '\r', '\u000B', '\u000C', '\u0085', '\u2028', '\u2029']) expect(safeCloudAgentModel(`grok${lb}-4`)).toBeNull();
  });

  it('refuses shell and git metacharacters and ref escapes in a branch', () => {
    for (const b of ['-upload-pack=x', 'a..b', 'a//b', 'a/', 'a.', 'a.lock', 'a@{1}', 'a b', 'a;b', 'a$(id)', 'a`id`', "a'b", 'a"b', 'a|b', 'a&b', 'a>b', 'a\\b', 'a~1', 'a^b', 'a:b', 'a*b', 'a?b', '[a]', '/abs', '../x', '.hidden']) {
      expect(safeCloudAgentBranch(b), b).toBeNull();
    }
  });

  it('refuses URLs, especially URLs carrying credentials', () => {
    for (const v of ['https://github.com/o/r', 'https://x-access-token:ghs_abc@github.com/o/r.git', 'user:pw@host', 'git@github.com:o/r.git', 'file:///etc/passwd', 'http://169.254.169.254/latest']) {
      expect(safeCloudAgentBranch(v), v).toBeNull(); expect(safeCloudAgentModel(v), v).toBeNull(); expect(safeCloudAgentId(v), v).toBeNull();
    }
  });

  it('refuses key-looking strings', () => {
    const keys = [
      'sk-ant-api03-abcdef', 'xai-abcdefABCDEF0123', 'ghp_' + 'a'.repeat(36), 'github_pat_11ABCDEF', 'cursor/ghs_abc123', 'feature/sk-live-1',
      'key_' + '0123456789abcdef'.repeat(4), 'crsr_abcdef', 'Bearer-abc', 'authorization-x', 'private-key-1', 'a'.repeat(32), 'cursor/AKIA' + 'B'.repeat(28), 'api_key-1', 'cursor/apikey_x',
    ];
    for (const k of keys) {
      expect(safeCloudAgentBranch(k), k).toBeNull(); expect(safeCloudAgentModel(k), k).toBeNull();
    }
    expect(safeCloudAgentId('bc-sk_ant-0000')).toBeNull();
  });

  it('unicode tricks: lookalikes and non-ASCII are refused; invisible format characters are stripped', () => {
    expect(safeCloudAgentModel('gr\u043Ek-4')).toBeNull();            // Cyrillic o
    expect(safeCloudAgentBranch('cursor/fix\uFF0F1')).toBeNull();     // fullwidth solidus
    expect(safeCloudAgentBranch('cursor/caf\u00E9')).toBeNull();
    expect(safeCloudAgentModel('grok\u202E4-kc')).toBe('grok4-kc');   // bidi override stripped, never rendered
    expect(safeCloudAgentModel('grok\u200D-4\uFEFF')).toBe('grok-4');
    expect(safeCloudAgentId(AGENT.toUpperCase())).toBeNull();
    expect(safeCloudAgentId(AGENT.replace('bc-', 'bc\u2010'))).toBeNull(); // hyphen lookalike
    expect(safeCloudAgentModel('\u200B\u200C\u200D')).toBeNull();
  });

  it('a JuliusDispatchError carries the three only in sanitized form', () => {
    const e = new JuliusDispatchError('CODER_FAILED' as never, false, 'x', 'coder_grok_patch_apply_failed', {
      cursorAgentId: AGENT, agentBranch: `${BRANCH}\nforged`, cursorServedModel: 'sk-ant-api03-zzz', apiKey: 'sk-ant-api03-zzz', cursorApiKey: 'key_abc',
    });
    expect(e.diagnostics?.cursorAgentId).toBe(AGENT);
    expect(e.diagnostics?.agentBranch).toBeNull();
    expect(e.diagnostics?.cursorServedModel).toBeNull();
    expect(Object.keys(e.diagnostics ?? {})).not.toContain('apiKey');
    expect(Object.keys(e.diagnostics ?? {})).not.toContain('cursorApiKey');
    expect(JSON.stringify(e.diagnostics)).not.toContain('sk-ant');
  });

  it('older keys are untouched: the existing servedModel and codingAgentProvider rules are unchanged', () => {
    const r = d({ servedModel: 'grok-build-0.1', cursorServedModel: MODEL });
    expect(r.servedModel).toBe('grok-build-0.1');
    expect(r.cursorServedModel).toBe(MODEL);
    expect(d({ servedModel: 'x'.repeat(49) }).servedModel).toBeNull();
    expect(d({ codingAgentProvider: 'grok-bot-cloud-agent' }).codingAgentProvider).toBeNull(); // safeToken: unchanged, dashes are not admitted there
    expect(d({ codingAgentProvider: 'claude_code' }).codingAgentProvider).toBe('claude_code');
  });
});

describe('router diagnostics F7: the durable row of a cloud coding agent run', () => {
  const good = {
    codingAgentTransport: 'cursor_cloud_agents_v1', transportMode: 'live', servedModelVerdict: 'UNATTESTED', servedModelAttestation: 'reported_by_provider',
    spendVerified: false, chargedAs: 'FULL_RESERVATION', billingNote: 'pool_credit_spend_unverified', cursorRunId: 'run-0f1e2d3c', cursorRequestId: 'req_abc-123',
    cursorRunCreatedAt: '2026-10-30T16:00:00.000Z', runResponseSha256: 'a'.repeat(64), receiptRunIdMatches: true, baseRevision: '1'.repeat(40), agentHeadSha: '2'.repeat(40),
    patchApplied: true, outcomeUnknown: false, cancelRequested: 'not_cancellable',
  } as const;
  it('admits each well-formed value as is', () => {
    expect(d(good)).toMatchObject(good);
  });
  it('absent is null; values outside each closed vocabulary or shape are null', () => {
    const r = d({});
    for (const k of Object.keys(good)) expect(r[k], k).toBeNull();
    const bad = d({
      codingAgentTransport: 'cursor-cloud-agents-v1', transportMode: 'LIVE', servedModelVerdict: 'match', servedModelAttestation: 'model_id_echo',
      spendVerified: 'false', chargedAs: 'NOTHING', billingNote: 'no bill', cursorRunId: 'run\nx', cursorRequestId: `sk-ant-${'a'.repeat(40)}`,
      cursorRunCreatedAt: 'yesterday', runResponseSha256: 'A'.repeat(64), receiptRunIdMatches: 1, baseRevision: 'g'.repeat(40), agentHeadSha: '2'.repeat(41),
      patchApplied: 'yes', outcomeUnknown: null, cancelRequested: 'maybe',
    });
    for (const k of Object.keys(good)) expect(bad[k], k).toBeNull();
  });
  it('run and request ids are bounded and refuse secret-shaped or line-broken values', () => {
    expect(safeCloudAgentRunId('x'.repeat(129))).toBeNull();
    expect(safeCloudAgentRunId(`run-${'a1'.repeat(20)}`)).toBeNull(); // a 32+ alphanumeric run reads like a key
    expect(safeCloudAgentRunId('run-1\r\n[INFO] spend verified')).toBeNull();
    expect(safeCloudAgentRunId('3f2a1b4c-0d9e-4f8a-b7c6-1e2d3c4b5a69')).toBe('3f2a1b4c-0d9e-4f8a-b7c6-1e2d3c4b5a69');
  });
  it('the provider and transport kinds are router tokens now (dashed kinds were dropped)', () => {
    expect(d({ codingAgentProvider: 'grok_bot_cloud_agent' }).codingAgentProvider).toBe('grok_bot_cloud_agent');
    expect(d({ codingAgentTransport: 'cursor_cloud_agents_v1' }).codingAgentTransport).toBe('cursor_cloud_agents_v1');
  });
});
