import { describe, expect, it } from 'vitest';

import {
  JULIUS_ACTION_RISKS,
  JULIUS_APPROVAL_REQUIRED_RISKS,
  MCP_VOCABULARY,
  juliusActionRiskOfMcp,
  juliusActionRiskSeverity,
  juliusEffectForRisk,
  juliusPolicyOperationsForMcp,
  juliusRiskRequiresApproval,
  juliusToolRiskOf,
  mcpRoleForJuliusRole,
  strictestJuliusEffect,
  type JuliusActionRisk,
} from './mcp-authority-translation';
import { JULIUS_DEFAULT_ROLES, type JuliusPolicyEffect, type JuliusWorkerRole } from '../../mission/julius';

/**
 * THE BRIDGE MAY NARROW. IT MAY NEVER WIDEN.
 *
 * Every case reads MCP's own exported constants through `MCP_VOCABULARY`
 * rather than restating them, because a proof that restates the thing it
 * guards passes forever after the thing changes. A ninth risk class or a
 * seventh role added in `src/relay/mcp` fails a test here rather than taking
 * a fallback nobody chose.
 */

const ALL_EFFECTS: readonly JuliusPolicyEffect[] = ['ALLOW', 'LIMITED', 'REQUIRE_APPROVAL', 'DENY'];

describe('the risk vocabularies are one vocabulary', () => {
  it('translates every MCP class MCP declares — none falls through', () => {
    for (const risk of MCP_VOCABULARY.risks) {
      const canonical = juliusActionRiskOfMcp(risk);
      expect(JULIUS_ACTION_RISKS, `MCP class ${risk} must have a canonical name`).toContain(canonical);
    }
    expect(MCP_VOCABULARY.risks.length, 'and the two sets are the same size, so neither has a class the other lacks')
      .toBe(JULIUS_ACTION_RISKS.length);
  });

  it('agrees with MCP about the ORDER, including unknown above destructive', () => {
    // The canonical severity table is a copy, deliberately. This is what stops
    // the copy drifting: if MCP reorders, this fails rather than the two
    // silently disagreeing about which of two risks is worse.
    for (const risk of MCP_VOCABULARY.risks) {
      expect(juliusActionRiskSeverity(juliusActionRiskOfMcp(risk)), `severity of ${risk}`)
        .toBe(MCP_VOCABULARY.severityOf(risk));
    }
    expect(juliusActionRiskSeverity('unknown'), 'not knowing what a call does outranks knowing it is destructive')
      .toBeGreaterThan(juliusActionRiskSeverity('destructive'));
  });

  it('keeps every class MCP puts to a human as one Julius will not take on its own authority', () => {
    /**
     * THE ESCALATION THIS FILE EXISTS TO PREVENT. If an approval-gated class
     * arrived at Julius as ALLOW, the bridge would have laundered a human
     * decision into an automatic one — and it would look like unification.
     */
    for (const risk of MCP_VOCABULARY.humanApprovalRisks) {
      const canonical = juliusActionRiskOfMcp(risk);
      expect(juliusRiskRequiresApproval(canonical), `${risk} must still need a human`).toBe(true);
      expect(juliusEffectForRisk(canonical), `${risk} must never arrive as ALLOW`).toBe('REQUIRE_APPROVAL');
    }
    expect([...JULIUS_APPROVAL_REQUIRED_RISKS].sort(), 'and the two lists are the same list')
      .toEqual([...MCP_VOCABULARY.humanApprovalRisks].map(juliusActionRiskOfMcp).sort());
  });

  it('projects to LOW/MEDIUM/HIGH monotonically — a worse risk never lands on a lower rung', () => {
    const rung: Readonly<Record<string, number>> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    for (const a of JULIUS_ACTION_RISKS) {
      for (const b of JULIUS_ACTION_RISKS) {
        if (juliusActionRiskSeverity(a) >= juliusActionRiskSeverity(b)) {
          expect(rung[juliusToolRiskOf(a)]!, `${a} is at least as severe as ${b}, so it cannot project lower`)
            .toBeGreaterThanOrEqual(rung[juliusToolRiskOf(b)]!);
        }
      }
    }
  });

  it('projects everything that needs a human to HIGH, so the old scale cannot call it routine', () => {
    for (const risk of JULIUS_APPROVAL_REQUIRED_RISKS) {
      expect(juliusToolRiskOf(risk), `${risk} on the three-value scale`).toBe('HIGH');
    }
  });
});

describe('a role is translated or refused, never substituted', () => {
  it('translates every role Julius declares', () => {
    for (const role of JULIUS_DEFAULT_ROLES) {
      const translated = mcpRoleForJuliusRole(role);
      expect(translated.translated, `${role} must have a decision`).toBe(true);
      if (translated.translated) {
        expect(MCP_VOCABULARY.roles, `${role} must map to a role MCP knows`).toContain(translated.role);
      }
    }
  });

  it('sends the Independent Reviewer to a role MCP ITSELF forbids', () => {
    /**
     * Read from `MCP_FORBIDDEN_ROLES` rather than asserted as a literal. The
     * Reviewer's isolation is a rule no grant can override, and it must keep
     * coming from that rule — a second copy here could drift away from it and
     * the drift would look like agreement.
     */
    const reviewer = mcpRoleForJuliusRole('INDEPENDENT_REVIEWER');
    expect(reviewer.translated).toBe(true);
    if (reviewer.translated) {
      expect(MCP_VOCABULARY.forbiddenRoles, 'a reviewing role with tool access is not independent of what it reviews')
        .toContain(reviewer.role);
    }
  });

  it('refuses a SPECIALIST rather than lending it another role\'s entitlement', () => {
    /**
     * `SPECIALIST:${string}` is an OPEN set — anyone may name one, and nothing
     * declares what one may do. Mapping it to `coding-agent` would hand every
     * invented specialist mission-scoped writes; mapping it to a role that
     * happens to have empty defaults today would hand them whatever that role
     * is given tomorrow. Refusing is the only answer that cannot become an
     * escalation later.
     */
    for (const role of ['SPECIALIST:db-migration', 'SPECIALIST:', 'SPECIALIST:anything at all'] as JuliusWorkerRole[]) {
      const translated = mcpRoleForJuliusRole(role);
      expect(translated.translated, `${role} must not be translated`).toBe(false);
      if (!translated.translated) {
        expect(translated.reasonCode).toBe('MCP_ROLE_UNTRANSLATABLE');
        expect(translated.safeRationale).toMatch(/refused/u);
      }
    }
  });

  it('refuses anything that is not a declared role, including near-misses', () => {
    /**
     * These are cast through `unknown` because TypeScript REFUSES them, which
     * is the first line of this defence and worth saying out loud. The second
     * line is this function, for the values that arrive as strings at runtime
     * — a role read back from storage, or one an MCP role name was mistaken
     * for. `'coding-agent'` is MCP's spelling of a real role and is exactly
     * the value a string comparison between the two vocabularies would have
     * accepted.
     */
    for (const role of ['coding-agent', 'CODING_AGENT ', 'prompt_architect', '', 'architect'] as unknown as JuliusWorkerRole[]) {
      expect(mcpRoleForJuliusRole(role).translated, `${JSON.stringify(role)} is not a Julius role`).toBe(false);
    }
  });

  it('never collapses two Julius roles onto one MCP role', () => {
    // Collapsing would let one role act under another's grants, which is the
    // same escalation as a wrong mapping and much harder to see.
    const mapped = JULIUS_DEFAULT_ROLES
      .map((role) => mcpRoleForJuliusRole(role))
      .flatMap((result) => (result.translated ? [result.role] : []));
    expect(new Set(mapped).size, 'distinct roles stay distinct').toBe(mapped.length);
  });
});

describe('what C.A.R.D. is asked about an MCP invocation', () => {
  it('calls a stdio server a PROCESS and an HTTP server a NETWORK call, never the other way round', () => {
    /**
     * A stdio server is a child process this host spawns. Declaring it as
     * network access would let a policy that forbids process execution
     * authorise a spawn — the gate would be green for the wrong question.
     */
    const stdio = juliusPolicyOperationsForMcp({ risk: 'read_only', transport: 'stdio' });
    expect(stdio).toContain('EXECUTE_PROCESS');
    expect(stdio).not.toContain('ACCESS_NETWORK');

    const http = juliusPolicyOperationsForMcp({ risk: 'read_only', transport: 'http' });
    expect(http).toContain('ACCESS_NETWORK');
    expect(http).not.toContain('EXECUTE_PROCESS');
  });

  it('always asks USE_TOOL, and asks about mutation only when the act mutates', () => {
    for (const transport of ['stdio', 'http'] as const) {
      for (const risk of JULIUS_ACTION_RISKS) {
        const operations = juliusPolicyOperationsForMcp({ risk, transport });
        expect(operations, `${risk}/${transport}`).toContain('USE_TOOL');
        expect(operations.includes('MUTATE_FILESYSTEM'), `${risk} mutates the workspace?`)
          .toBe(risk === 'workspace_write');
      }
    }
  });
});

describe('the composite decision is the strictest of the two', () => {
  it('is never weaker than either side, for every pair', () => {
    /**
     * "One Julius, one tool authority, multiple connection protocols" reduces
     * to this: the gateway's `allow` is necessary and NOT sufficient, and so
     * is Julius's. Neither can stand alone, which is what stops the gateway
     * becoming a second authority beside JuliusToolController.
     */
    const order: Readonly<Record<JuliusPolicyEffect, number>> = { ALLOW: 0, LIMITED: 1, REQUIRE_APPROVAL: 2, DENY: 3 };
    for (const a of ALL_EFFECTS) {
      for (const b of ALL_EFFECTS) {
        const combined = strictestJuliusEffect(a, b);
        expect(order[combined], `${a} + ${b}`).toBe(Math.max(order[a], order[b]));
      }
    }
  });

  it('cannot be talked back to ALLOW by the other side agreeing', () => {
    for (const effect of ALL_EFFECTS) {
      expect(strictestJuliusEffect('DENY', effect), 'a denial survives any agreement').toBe('DENY');
    }
    expect(strictestJuliusEffect('REQUIRE_APPROVAL', 'ALLOW'), 'and an approval requirement is not waived by an ALLOW')
      .toBe('REQUIRE_APPROVAL');
  });

  it('puts an approval-gated risk beyond reach of an ALLOW policy', () => {
    // The end-to-end shape of the first obligation: a policy that would allow
    // the operation still cannot make a destructive MCP call automatic.
    const risk: JuliusActionRisk = juliusActionRiskOfMcp('destructive');
    expect(strictestJuliusEffect(juliusEffectForRisk(risk), 'ALLOW')).toBe('REQUIRE_APPROVAL');
  });
});
