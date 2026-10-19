import { describe, expect, it } from 'vitest';

import {
  RELAY_AGENT_ROLES,
  operatingProfileFixture,
  operatingProfileFixtures,
  projectAgentOperatingProfile,
  projectAgentOperatingProfiles,
} from '../mission';
import { renderAgentOperatingProfile, renderAgentOperatingProfiles } from './agent-operating';

/**
 * WEBSITE/CLI AGREEMENT.
 *
 * The website inspector and this renderer consume the SAME projection. These
 * tests hold the CLI to the projection's own values rather than to a copy of
 * them, so a CLI that started formatting its own labels — the way two surfaces
 * begin disagreeing — fails here.
 */

const options = { width: 80, plain: true };

describe('the CLI renders the shared projection, and formats nothing itself', () => {
  it('prints every row VALUE exactly as the projection worded it', () => {
    for (const profile of operatingProfileFixtures()) {
      const projection = projectAgentOperatingProfile(profile);
      const text = renderAgentOperatingProfile(projection, options).join('\n');
      for (const row of projection.rows) {
        expect(text, `${row.label} value missing`).toContain(row.label);
        // The value may be wrapped across lines, so the first word is the
        // anchor — but no SUBSTITUTE wording may appear.
        expect(text).toContain(row.value.split(' ')[0]);
      }
    }
  });

  it('prints the four components in the canonical order, and no fifth', () => {
    const projection = projectAgentOperatingProfile(operatingProfileFixture('coding_agent'));
    const lines = renderAgentOperatingProfile(projection, options);
    const order = ['Runtime', 'Mission Contract', 'Environment', 'Tools']
      .map((label) => lines.findIndex((l) => l.includes(label)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('discloses simulated data, from the projection’s own banner', () => {
    const projection = projectAgentOperatingProfile(operatingProfileFixture('reviewer'));
    const text = renderAgentOperatingProfiles([projection], options).join('\n');
    expect(text).toContain('SIMULATED DATA');
    expect(text).toContain('no runtime is attached');
  });

  it('never prints a secret, a token or an invented provider', () => {
    const text = renderAgentOperatingProfiles(
      projectAgentOperatingProfiles(operatingProfileFixtures()),
      options,
    ).join('\n');
    for (const shape of [/sk-[A-Za-z0-9-]{8,}/, /ghp_[A-Za-z0-9]{8,}/, /token\s*[:=]/i, /password/i]) {
      expect(shape.test(text)).toBe(false);
    }
    expect(text).not.toMatch(/claude-3|gpt-4|sonnet|opus/i);
  });

  it('says Not connected rather than implying an attached runtime', () => {
    const text = renderAgentOperatingProfiles(
      projectAgentOperatingProfiles(operatingProfileFixtures()),
      options,
    ).join('\n');
    expect(text).toContain('Not connected');
  });

  it('renders every role, in canonical order', () => {
    const text = renderAgentOperatingProfiles(
      projectAgentOperatingProfiles(operatingProfileFixtures()),
      options,
    ).join('\n');
    const at = ['PROMPT ARCHITECT', 'CODING AGENT', 'REVIEWER'].map((n) => text.indexOf(n));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(RELAY_AGENT_ROLES.length).toBe(3);
  });

  it('degrades gracefully on a narrow terminal without losing a component', () => {
    const projection = projectAgentOperatingProfile(operatingProfileFixture('coding_agent'));
    for (const width of [40, 60, 100, 140]) {
      const lines = renderAgentOperatingProfile(projection, { width, plain: true });
      for (const row of projection.rows) {
        expect(lines.join('\n'), `${row.label} lost at width ${width}`).toContain(row.label);
      }
      // Nothing may overrun the terminal it was told about.
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(Math.max(width, 60) + 20);
    }
  });

  it('emits no ANSI escape in plain mode', () => {
    const text = renderAgentOperatingProfiles(
      projectAgentOperatingProfiles(operatingProfileFixtures()),
      options,
    ).join('\n');
    // eslint-disable-next-line no-control-regex
    expect(/\[/.test(text)).toBe(false);
  });
});

describe('plain mode is genuinely plain', () => {
  /**
   * THE HONEST BOUNDARY. Plain mode governs the chrome THIS renderer draws —
   * its heading rule and its separators. It deliberately does NOT ASCII-fold
   * the row VALUES, because those come from the shared projection and the
   * website renders the identical strings; folding them here would make the
   * two surfaces disagree, which is the one thing this feature exists to
   * prevent. The `·` in `Claude Code · Not connected` is the product's
   * separator on both surfaces.
   */
  it('uses no non-ASCII glyph in the chrome this renderer draws', () => {
    const lines = renderAgentOperatingProfiles(
      projectAgentOperatingProfiles(operatingProfileFixtures()),
      { width: 80, plain: true },
    );
    const projections = projectAgentOperatingProfiles(operatingProfileFixtures());
    // Everything the PROJECTION worded — row values and the shared disclosure
    // banner — is rendered verbatim on both surfaces, so it is not chrome.
    const shared = new Set<string>();
    for (const p of projections) {
      for (const row of p.rows) for (const word of row.value.split(/\s+/)) shared.add(word);
      if (p.dataSourceLabel !== null) for (const word of p.dataSourceLabel.split(/\s+/)) shared.add(word);
    }
    for (const line of lines) {
      const chrome = line.split(/\s+/).filter((word) => word !== '' && !shared.has(word)).join(' ');
      expect(/[^\x00-\x7F]/.test(chrome), `non-ASCII chrome: ${JSON.stringify(line)}`).toBe(false);
    }
  });

  it('the heading and the rule are ASCII when plain was asked for', () => {
    const lines = renderAgentOperatingProfiles(
      projectAgentOperatingProfiles(operatingProfileFixtures()),
      { width: 80, plain: true },
    );
    expect(lines[0]).toBe('AGENT - PROMPT ARCHITECT');
    expect(lines.some((l) => l.includes('---'))).toBe(true);
    expect(lines.some((l) => l.includes('─'))).toBe(false);
  });

  it('still draws the rule when plain was NOT asked for', () => {
    const text = renderAgentOperatingProfiles(
      projectAgentOperatingProfiles(operatingProfileFixtures()),
      { width: 80, plain: false },
    ).join('\n');
    expect(text).toContain('─');
  });
});
