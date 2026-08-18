import { describe, expect, it } from 'vitest';
import {
  COLISEUM_DEMO_DISCLOSURE,
  COLISEUM_FIXTURE_DISCLOSURE,
  buildColiseumFixture,
  formatDelta,
  formatMaybe,
  renderColiseumCommands,
  renderColiseumDuel,
  renderColiseumNoDuel,
} from './coliseum-cli';
import { parseCli, runCli } from './main';

const OPTS = { width: 100, plain: true };
// Prose is wrapped to the terminal width, so phrase assertions run against a
// whitespace-normalized rendering; line-order assertions use the raw lines.
const text = (lines: string[]): string => lines.join('\n').replace(/\s+/gu, ' ');

describe('Coliseum CLI — fixture disclosure is structural', () => {
  it('every duel render states SIMULATED DATA before any figure', () => {
    const fixture = buildColiseumFixture();
    for (const view of [fixture.concluded, fixture.activeFight, fixture.challenged]) {
      const lines = renderColiseumDuel(view, fixture.source, OPTS);
      const out = text(lines);
      expect(out).toContain(COLISEUM_FIXTURE_DISCLOSURE);
      expect(out).toContain('no live Coliseum data source');
      // The banner precedes the first fact line (Status).
      const banner = lines.findIndex((l) => l.includes('SIMULATED DATA'));
      const firstFigure = lines.findIndex((l) => l.includes('Status'));
      expect(banner).toBeGreaterThanOrEqual(0);
      expect(firstFigure).toBeGreaterThan(banner);
    }
  });

  it('the fixture builder declares its source and derives views from the shared projection', () => {
    const fixture = buildColiseumFixture();
    expect(fixture.source).toBe('development_fixture');
    expect(fixture.concluded.duelId).toBe('duel-fixture-concluded-1');
    expect(fixture.activeFight.mode).toBe('automation-fight');
    expect(fixture.challenged.status).toBe('challenged');
  });
});

describe('Coliseum CLI — unknown is not zero', () => {
  it('a null measurement prints the word Unknown, never 0', () => {
    expect(formatMaybe(null)).toBe('Unknown');
    expect(formatDelta(null)).toBe('Unknown');
    expect(formatDelta(3)).toBe('+3');
    expect(formatDelta(-2)).toBe('-2');
  });

  it('unmeasured participants render Unknown in the proof meter', () => {
    const fixture = buildColiseumFixture();
    const out = text(renderColiseumDuel(fixture.concluded, fixture.source, OPTS));
    // sw-ledger was never measured; the fixture leaves all three null.
    expect(out).toContain('Unknown');
    // aria's reliability/performance deltas are also null in the fixture —
    // there must be no fabricated numeric where the projection says null.
    const ledger = fixture.concluded.participants.find((p) => p.participantId === 'sw-ledger');
    expect(ledger?.evaluationQuality).toBeNull();
  });
});

describe('Coliseum CLI — claims are not evidence', () => {
  it('an unverified proof entry prints 0 pts and says it is an unverified claim', () => {
    const fixture = buildColiseumFixture();
    const out = text(renderColiseumDuel(fixture.concluded, fixture.source, OPTS));
    expect(out).toContain('0 pts (UNVERIFIED CLAIM — not evidence)');
    // The unverified performance claim from the fixture appears with 0 points.
    expect(out).toContain('Claimed 2x speedup');
  });

  it('verified entries carry their points', () => {
    const fixture = buildColiseumFixture();
    const aria = fixture.concluded.participants.find((p) => p.participantId === 'agent-aria');
    expect(aria).toBeDefined();
    const verified = aria!.entries.filter((e) => e.verified);
    const out = text(renderColiseumDuel(fixture.concluded, fixture.source, OPTS));
    for (const entry of verified) {
      expect(out).toContain(`${entry.points} pts (verified)`);
    }
  });
});

describe('Coliseum CLI — command bindings are truthful', () => {
  it('unbound commands say they have no engine; bound commands say bound', () => {
    const fixture = buildColiseumFixture();
    const out = text(renderColiseumCommands(fixture.concluded.commands, OPTS));
    for (const command of fixture.concluded.commands) {
      expect(out).toContain(`/${command.name}`);
    }
    expect(out).toContain('UNBOUND — no engine; refuses rather than fabricates');
    const unbound = fixture.concluded.commands.filter((c) => c.binding === 'unbound');
    const bound = fixture.concluded.commands.filter((c) => c.binding === 'bound');
    expect(unbound.length).toBeGreaterThan(0);
    expect(bound.length).toBeGreaterThan(0);
  });
});

describe('Coliseum CLI — winner truthfulness', () => {
  it('an active fight has no winner and says the duel has not concluded', () => {
    const fixture = buildColiseumFixture();
    const out = text(renderColiseumDuel(fixture.activeFight, fixture.source, OPTS));
    expect(out).toContain('Not decided — the duel has not concluded');
    expect(out).not.toContain('Winner declared');
  });

  it('a concluded duel names the actual winner from the projection', () => {
    const fixture = buildColiseumFixture();
    const out = text(renderColiseumDuel(fixture.concluded, fixture.source, OPTS));
    expect(out).toContain('agent-aria');
  });
});

describe('Coliseum CLI — the empty state invents nothing', () => {
  it('renderColiseumNoDuel states no duel exists and shows no figures', () => {
    const out = text(renderColiseumNoDuel(OPTS));
    expect(out).toContain('No duel exists');
    expect(out).toContain('nothing is shown in its place');
    // No score, XP, winner, or command output is fabricated.
    expect(out).not.toContain('Proof score');
    expect(out).not.toContain('XP');
    expect(out).not.toContain('Winner');
    expect(out).not.toMatch(/\d+ pts/u);
  });
});

describe('Coliseum CLI — narrow terminals keep every fact', () => {
  it('a 40-column render still carries the disclosure and the unknowns', () => {
    const fixture = buildColiseumFixture();
    const out = text(renderColiseumDuel(fixture.concluded, fixture.source, { width: 40, plain: true }));
    expect(out).toContain('SIMULATED DATA');
    expect(out).toContain('Unknown');
  });
});

describe('Coliseum CLI — `relay mission coliseum` dispatches through the entry', () => {
  function capture() {
    const lines: string[] = [];
    return {
      io: { out: (line: string) => lines.push(line), isTTY: false, env: {} as NodeJS.ProcessEnv },
      text: () => lines.join('\n'),
    };
  }

  it('parses as a mission action with no error', () => {
    const parsed = parseCli(['mission', 'coliseum']);
    expect(parsed.command).toBe('mission');
    expect(parsed.missionAction).toBe('coliseum');
    expect(parsed.error).toBeUndefined();
  });

  it('runCli renders every fixture duel with the disclosure before any figure', async () => {
    const { io, text: rendered } = capture();
    const code = await runCli(['mission', 'coliseum'], io);
    expect(code).toBe(0);
    const out = rendered();
    expect(out).toContain('WONDERLAND COLISEUM — DUEL');
    expect(out).toContain(COLISEUM_FIXTURE_DISCLOSURE);
    // All three fixture duels are rendered, each derived from the shared
    // projection — the same views the fixture builder returns.
    const fixture = buildColiseumFixture();
    expect(out).toContain(fixture.concluded.duelId);
    expect(out).toContain(fixture.activeFight.duelId);
    expect(out).toContain(fixture.challenged.duelId);
    // The disclosure precedes the first fact line.
    expect(out.indexOf('SIMULATED DATA')).toBeLessThan(out.indexOf('Status'));
  });

  it('the mission action list names coliseum in the usage error', () => {
    expect(parseCli(['mission']).error).toContain('coliseum');
  });

  it('an unknown coliseum argument is a usage error, not a silent fixture render', async () => {
    const { io, text: rendered } = capture();
    const code = await runCli(['mission', 'coliseum', 'bogus'], io);
    expect(code).not.toBe(0);
    expect(rendered()).toContain("or 'demo'");
  });
});

describe('Coliseum CLI — `relay mission coliseum demo` runs the REAL engines offline', () => {
  function capture() {
    const lines: string[] = [];
    return {
      io: { out: (line: string) => lines.push(line), isTTY: false, env: {} as NodeJS.ProcessEnv },
      text: () => lines.join('\n'),
    };
  }

  it('discloses REAL ENGINES / DEMONSTRATION INPUTS before any result, and never the SIMULATED banner', async () => {
    const { io, text: rendered } = capture();
    const code = await runCli(['mission', 'coliseum', 'demo'], io);
    expect(code).toBe(0);
    const out = rendered();
    expect(out).toContain(COLISEUM_DEMO_DISCLOSURE);
    // The demo is real engine output over demo inputs — the fixture banner
    // ('SIMULATED DATA — ... NOT LIVE DUEL DATA') must NOT appear.
    expect(out).not.toContain(COLISEUM_FIXTURE_DISCLOSURE);
    expect(out.indexOf(COLISEUM_DEMO_DISCLOSURE)).toBeLessThan(out.indexOf('/TRACE'));
  });

  it('dispatches TRACE, SB and VERIFY through the real engines and refuses RED truthfully', async () => {
    const { io, text: rendered } = capture();
    await runCli(['mission', 'coliseum', 'demo'], io);
    const out = rendered();
    // TRACE: the real Aquala ledger — genesis + the two seeded command events.
    expect(out).toContain('/TRACE → 3 ledger entries');
    expect(out).toContain('trace-duel-demo-duel-001-genesis');
    expect(out).toContain('command_executed: sandboxes provisioned for both participants');
    // SB: the real bounded repair loop, verifier-closed.
    expect(out).toMatch(/\/SB → repaired — .*verifier/iu);
    // VERIFY: the real reviewer gate, independent verifier named.
    expect(out).toContain('/VERIFY → verified-true (independent verifier: gate-verifier)');
    // RED has no engine on main; the resolver refuses, nothing is fabricated.
    expect(out).toMatch(/\/RED → REFUSED: RED has no engine on main/u);
  });

  it('runs the bounded automation fight through the real loop-agent port with real costs', async () => {
    const { io, text: rendered } = capture();
    await runCli(['mission', 'coliseum', 'demo'], io);
    const out = rendered();
    expect(out).toContain('Turn cap: 2 · Budget cap: not configured');
    expect(out).toContain('auto-red turn 1: completed (cost 1000 micros)');
    expect(out).toContain('auto-blue turn 2: completed (cost 1000 micros)');
    expect(out).toContain('Relay ran the check itself.');
  });

  it('awards XP through the real conclusion writer, labels the volatile backing, and refuses a double award', async () => {
    const { io, text: rendered } = capture();
    await runCli(['mission', 'coliseum', 'demo'], io);
    const out = rendered();
    // The store's own durability label — the demo ledger is in-memory and says so.
    expect(out).toContain('[volatile-test-only]');
    // auto-red: verified repair-accepted + opponent-fix bonus 50 + winner 25.
    expect(out).toMatch(/auto-red: WRITTEN — \d+ XP \(opponent-fix bonus 50\); ledger total \d+/u);
    // auto-blue's unverified claim earns 0 — truthfully written as 0.
    expect(out).toContain('auto-blue: WRITTEN — 0 XP (opponent-fix bonus 0); ledger total 0');
    expect(out).toContain('second award refused:');
    expect(out).toContain('already awarded');
    expect(out).not.toContain('DOUBLE-AWARD BUG');
  });
});
