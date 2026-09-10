import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { JULIUS_VISUAL_STATES } from './wonderland-julius-state';
import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import { WONDERLAND_WORKER_ROLES } from './wonderland-envelope';
import { wonderlandWireEnums } from './wonderland-wire-contract';
import {
  WONDERLAND_WIRE_DELIVERIES_PATH,
  WONDERLAND_WIRE_FIXTURES_PATH,
  WONDERLAND_WIRE_HYDRATIONS_PATH,
  WONDERLAND_WIRE_USAGES_PATH,
  renderWonderlandWireDeliveries,
  renderWonderlandWireFixtures,
  renderWonderlandWireHydrations,
  renderWonderlandWireUsages,
} from '../../../../scripts/export-wonderland-wire-fixtures';
import { WONDERLAND_BRAIN_KINDS } from './wonderland-brain-scope';
import { WONDERLAND_AUTONOMY_LEVELS } from './wonderland-hydration';
import { WONDERLAND_GATED_OPERATIONS } from './wonderland-human-gate';
import { RELAY_UNKNOWN_REASONS } from '../../shared/llmops';
import { JULIUS_ACTIVITY_SIGNALS } from './wonderland-julius-activity';

/**
 * THE CANONICAL FIXTURES, AS A CONTRACT WITH THE C++ SIDE.
 *
 * `wonderland/Tools/wire-decode-check.sh` drives these through the real decoder
 * and asserts each verdict; that is where the DECODING is proven. This is the
 * other half: that the file is fresh, that it covers both vocabularies whole,
 * and that nothing crosses in it which the client contract excludes.
 *
 * The pairing is what makes either half worth anything. A stale fixture file
 * passes the C++ harness forever — proving that last month's shapes still
 * decode — and a fresh one nobody drives proves nothing at all.
 */

const PATH = WONDERLAND_WIRE_FIXTURES_PATH;
const lines = readFileSync(join(process.cwd(), PATH), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');
const rows = lines.map((line) => {
  const [name, expect_, json] = line.split('\t');
  return { name, expect: expect_, json };
});

describe('the fixture file', () => {
  it('is committed, not generated into an ignored directory', () => {
    // `generated/` is gitignored, so fixtures written there vanish on a fresh
    // checkout and the harness reports success over an empty file. The ordering
    // case table lives in the source tree for the same reason.
    expect(PATH.startsWith('wonderland/')).toBe(true);
    expect(rows.length).toBeGreaterThan(30);
  });

  it('is what the generator renders right now', () => {
    // The half that keeps the C++ harness honest. A stale file passes it
    // forever, proving only that last month's shapes still decode.
    expect(
      readFileSync(join(process.cwd(), PATH), 'utf8'),
      'the wire fixtures are stale — run `npm run wonderland:wire:fixtures` and READ the diff',
    ).toBe(renderWonderlandWireFixtures());
    expect(
      readFileSync(join(process.cwd(), WONDERLAND_WIRE_DELIVERIES_PATH), 'utf8'),
      'the delivery fixtures are stale — run `npm run wonderland:wire:fixtures`',
    ).toBe(renderWonderlandWireDeliveries());
    expect(
      readFileSync(join(process.cwd(), WONDERLAND_WIRE_USAGES_PATH), 'utf8'),
      'the usage fixtures are stale — run `npm run wonderland:wire:fixtures`',
    ).toBe(renderWonderlandWireUsages());
    expect(
      readFileSync(join(process.cwd(), WONDERLAND_WIRE_HYDRATIONS_PATH), 'utf8'),
      'the hydration fixtures are stale — run `npm run wonderland:wire:fixtures`',
    ).toBe(renderWonderlandWireHydrations());
  });

  it('parses as three columns on every line', () => {
    for (const row of rows) {
      expect(row.name, `name on ${row.name}`).toBeTruthy();
      expect(row.expect, `expect on ${row.name}`).toBeTruthy();
      expect(() => JSON.parse(row.json), `json on ${row.name}`).not.toThrow();
    }
  });

  it('names only refusals the decoder can actually return', () => {
    // Taken from the C++ header, so a fixture cannot expect a reason that does
    // not exist — the harness would then compare two strings that never match
    // and report a failure nobody can act on.
    const header = readFileSync(
      join(process.cwd(), 'wonderland', 'Source', 'Wonderland', 'WonderlandWireDecode.h'), 'utf8');
    const known = new Set(['ok']);
    for (const match of header.matchAll(/^\t(\w+)(?:\s*=\s*0)?,?$/gm)) {
      known.add(match[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
    }
    for (const row of rows) {
      expect(known.has(row.expect), `${row.name} expects "${row.expect}"`).toBe(true);
    }
  });

  it('carries both accepted and refused cases, in quantity', () => {
    const accepted = rows.filter((r) => r.expect === 'ok');
    const refused = rows.filter((r) => r.expect !== 'ok');
    expect(accepted.length).toBeGreaterThan(10);
    expect(refused.length).toBeGreaterThan(10);
  });
});

describe('the vocabularies cross whole', () => {
  it('exercises every visual state', () => {
    // A state added on one side and not the other is exactly the drift the
    // pairing exists to catch — and it is caught by NAME, as `unknown_token`,
    // rather than by a world quietly showing Unobserved.
    for (const state of JULIUS_VISUAL_STATES) {
      expect(rows.some((r) => r.name === `state-${state}`), `no fixture for ${state}`).toBe(true);
    }
  });

  it('exercises every worker role', () => {
    for (const role of WONDERLAND_WORKER_ROLES) {
      expect(rows.some((r) => r.name === `role-${role}`), `no fixture for ${role}`).toBe(true);
    }
  });

  it('sends a token the decoder must refuse for each enum it reads', () => {
    // Coverage of the refusal path, not just the happy one. Each of the three
    // decoded enums has a fixture naming something outside its vocabulary.
    const decoded = wonderlandWireEnums()
      .filter((e) => ['EWonderlandJuliusState', 'EWonderlandJuliusStateSource', 'EWonderlandWorkerRole']
        .includes(e.cppEnum));
    expect(decoded.length).toBe(3);
    const unknownTokenCases = rows.filter((r) => r.expect === 'unknown_token');
    expect(unknownTokenCases.length).toBeGreaterThanOrEqual(3);
  });
});

describe('nothing crosses that the client contract excludes', () => {
  const everything = rows.map((r) => r.json).join(' ').toLowerCase();

  it('carries no provider or model name', () => {
    for (const name of ['gpt', 'claude', 'hermes', 'openai', 'anthropic', 'xai', 'gemini', 'codex']) {
      expect(everything, `a fixture mentions ${name}`).not.toContain(name);
    }
  });

  it('carries no credential, and proves the sanitiser is why', () => {
    // The `metadata-dropped` fixture is BUILT with a secret-shaped key. That it
    // is absent here is the sanitiser working on the real construction path —
    // not a fixture that politely omitted one.
    const dropped = rows.find((r) => r.name === 'metadata-dropped');
    expect(dropped).toBeDefined();
    const parsed = JSON.parse(dropped!.json) as {
      metadata: Record<string, unknown>; metadataDropped: number;
    };
    expect(Object.keys(parsed.metadata)).toEqual(['kept']);
    // And it SAYS one was dropped, without saying which — naming the key would
    // tell a viewer a credential exists.
    expect(parsed.metadataDropped).toBe(1);
    expect(dropped!.json).not.toContain('apiKey');
    expect(dropped!.json).not.toContain('sk-');
  });

  it('carries no free text a project author wrote', () => {
    // Every accepted fixture's fields are identifiers, closed-vocabulary tokens,
    // numbers or timestamps. Prose — a Project Brain entry, a safe summary, a
    // reasoning trace — has no field on this shape to occupy, and this notices
    // if one appears.
    for (const row of rows.filter((r) => r.expect === 'ok')) {
      const value = JSON.parse(row.json) as Record<string, unknown>;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string') continue;
        expect(item.length, `${row.name}.${key} is long enough to be prose`).toBeLessThan(120);
        expect(item, `${row.name}.${key} contains a sentence`).not.toMatch(/\.\s+[A-Z]/);
      }
    }
  });
});

describe('the delivery fixtures — what an SSE frame really carries', () => {
  const rows = readFileSync(join(process.cwd(), WONDERLAND_WIRE_DELIVERIES_PATH), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, expect_, json] = line.split('\t');
      return { name, expect: expect_, json };
    });

  it('carries the envelope AND the activity, because ApplyEnvelope takes both', () => {
    // The reduction that produces the activity lives in TypeScript and is
    // tested there; a second reduction in C++ would be a second answer to
    // "what is this run doing". So it travels beside the envelope.
    const quiet = rows.find((r) => r.name === 'delivery-quiet');
    expect(quiet).toBeDefined();
    const parsed = JSON.parse(quiet!.json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['activity', 'envelope']);
  });

  it('exercises every activity signal', () => {
    const every = rows.find((r) => r.name === 'delivery-every-signal');
    expect(every).toBeDefined();
    const parsed = JSON.parse(every!.json) as { activity: { signals: string[] } };
    expect([...parsed.activity.signals].sort()).toEqual([...JULIUS_ACTIVITY_SIGNALS].sort());
  });

  it('sends halves that disagree about identity, and expects a refusal', () => {
    // Nothing downstream compares them — every later check reads the envelope
    // alone — so a delivery whose activity named another project would push one
    // run's signals onto another's world.
    for (const name of ['delivery-foreign-activity-project', 'delivery-foreign-activity-run']) {
      const row = rows.find((r) => r.name === name);
      expect(row, `no fixture named ${name}`).toBeDefined();
      expect(row!.expect).toBe('identity_rejected');
    }
  });

  it('carries no provider name or credential either', () => {
    const everything = rows.map((r) => r.json).join(' ').toLowerCase();
    for (const name of ['gpt', 'claude', 'hermes', 'openai', 'anthropic', 'sk-']) {
      expect(everything, `a delivery fixture mentions ${name}`).not.toContain(name);
    }
  });
});

describe('the usage fixtures — what the meters carry', () => {
  const rows = readFileSync(join(process.cwd(), WONDERLAND_WIRE_USAGES_PATH), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, expect_, json] = line.split('\t');
      return { name, expect: expect_, json };
    });

  it('makes the PRODUCTION reading — all unknown — the first case', () => {
    // No authority reports into the usage contract, so this is what a world
    // actually draws today: two tracks and no remainder. It is the important
    // case, not the degenerate one.
    const unknown = rows.find((r) => r.name === 'usage-all-unknown');
    expect(unknown).toBeDefined();
    const hud = JSON.parse(unknown!.json) as {
      compoundAgent: Record<string, { known?: boolean }>;
      singleAgent: Record<string, { known?: boolean }>;
    };
    for (const meter of [hud.compoundAgent, hud.singleAgent]) {
      for (const field of ['capacityUnits', 'usedUnits', 'remainingUnits']) {
        expect(meter[field].known, `${field} should be unknown`).toBe(false);
      }
    }
  });

  it('carries every unknown reason, not just the zero member', () => {
    // `not_observed` is ordinal 0 in C++, so a fixture set containing only that
    // one cannot tell a decoder that READS the reason from one that hardcodes
    // the default. That mutation escaped until these existed.
    for (const reason of RELAY_UNKNOWN_REASONS) {
      expect(rows.some((r) => r.name === `usage-reason-${reason}`), `no fixture for ${reason}`).toBe(true);
    }
  });

  it('mislabels ONE meter at a time, so each channel check stands alone', () => {
    // A full swap is refused by either check, so with only that fixture either
    // one can be deleted while the other still catches it.
    for (const name of ['usage-compound-slot-holds-single', 'usage-single-slot-holds-compound']) {
      const row = rows.find((r) => r.name === name);
      expect(row, `no fixture named ${name}`).toBeDefined();
      expect(row!.expect).toBe('identity_rejected');
    }
  });

  it('sends both figure contradictions', () => {
    // known-with-null draws 0.0 as a measurement; unknown-with-a-value lets a
    // renderer read either half and get a different answer.
    for (const name of ['usage-known-with-null-value', 'usage-unknown-with-value']) {
      expect(rows.some((r) => r.name === name), `no fixture named ${name}`).toBe(true);
    }
  });

  it('carries no provider name', () => {
    const everything = rows.map((r) => r.json).join(' ').toLowerCase();
    for (const name of ['gpt', 'claude', 'openai', 'anthropic', 'hermes']) {
      expect(everything, `a usage fixture mentions ${name}`).not.toContain(name);
    }
  });
});

describe('the hydration fixtures — the payload a world adopts WHOLESALE', () => {
  const rows = readFileSync(join(process.cwd(), WONDERLAND_WIRE_HYDRATIONS_PATH), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, expect_, json] = line.split('\t');
      return { name, expect: expect_, json };
    });

  it('carries every half the wrapper wraps', () => {
    // The envelope path decodes what CHANGED. This decodes what is TRUE NOW,
    // and the reason it is one payload rather than four is that a world adopts
    // it in one act: usage, Project Brain, C.A.R.D. and activity all replace
    // themselves together, and nothing arriving afterwards contradicts any of
    // them. A half missing here would be a half nothing proves.
    const full = rows.find((r) => r.name === 'hydration-full');
    expect(full).toBeDefined();
    expect(Object.keys(JSON.parse(full!.json) as object).sort()).toEqual([
      'activity', 'brain', 'card', 'humanGates', 'observedAtIso', 'projectId',
      'run', 'schemaVersion', 'terminal', 'usage', 'usageStatus',
      'visualState', 'worldSessionId',
    ]);
  });

  it('makes the PRODUCTION shape — everything unknown — a first-class case', () => {
    // What the bridge actually serves today: no authority reports usage, no
    // reader resolves a C.A.R.D., no retrieval has been cited. Every one of
    // those must stay UNKNOWN across the seam. This is the case the whole
    // decoder exists for, not the degenerate one.
    const row = rows.find((r) => r.name === 'hydration-production-unknowns');
    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.json) as {
      run: Record<string, unknown>;
      card: Record<string, unknown>;
      usageStatus: { reading: string };
      brain: { contentHash: string };
      worldSessionId: string | null;
    };
    // NULL, not 0 and not false. Each of these is a fact nobody stated.
    expect(parsed.run.atSequence).toBeNull();
    expect(parsed.run.activeTasks).toBeNull();
    expect(parsed.run.pendingApprovals).toBeNull();
    expect(parsed.card.hasPromptArchitect).toBeNull();
    expect(parsed.card.hasCodingAgent).toBeNull();
    expect(parsed.card.hasIndependentReviewer).toBeNull();
    expect(parsed.card.autonomy).toBeNull();
    expect(parsed.worldSessionId).toBeNull();
    expect(parsed.usageStatus.reading).toBe('not_reported');
    // A citation nobody made is told from a retrieval that found nothing by
    // its EMPTY HASH, never by its zeroes.
    expect(parsed.brain.contentHash).toBe('');
  });

  it('sends a REPORTED zero beside the unknowns, so they cannot be confused', () => {
    // `pendingApprovals: 0` and `pendingApprovals: null` are different facts
    // that share a rendered digit. A fixture set with only one of them cannot
    // tell a decoder that reads the carrier from one that reads the number.
    const full = JSON.parse(rows.find((r) => r.name === 'hydration-full')!.json) as {
      run: { pendingApprovals: number | null; activeTasks: number | null };
    };
    expect(full.run.pendingApprovals).toBe(0);
    expect(full.run.activeTasks).toBe(3);
  });

  it('refuses every way one hydration can name another project or run', () => {
    // The attack the wrapper is shaped around. A mis-routed snapshot replaces
    // EVERYTHING at once with somebody else's picture, and every number on it
    // is real — so there is no later evidence, and no downstream check that
    // would notice.
    for (const name of [
      'hydration-foreign-run-project',
      'hydration-foreign-activity-project',
      'hydration-foreign-activity-run',
      'hydration-foreign-brain-project',
      'hydration-swapped-channels',
    ]) {
      const row = rows.find((r) => r.name === name);
      expect(row, `no fixture named ${name}`).toBeDefined();
      expect(row!.expect).toBe('identity_rejected');
    }
  });

  it('refuses a schema this build does not implement', () => {
    // Not pedantry: a payload naming another version may mean something else by
    // every key in it, and reading it against the fields this build knows would
    // be a guess made silently. Refusing is what lets bridge and client ship on
    // different days.
    const row = rows.find((r) => r.name === 'hydration-future-schema');
    expect(row).toBeDefined();
    expect(row!.expect).toBe('schema_rejected');
  });

  it('removes each half in turn, so no one of them is optional', () => {
    for (const part of ['run', 'usage', 'usageStatus', 'activity', 'brain', 'card']) {
      const row = rows.find((r) => r.name === `hydration-missing-${part}`);
      expect(row, `no fixture removing ${part}`).toBeDefined();
      expect(row!.expect).toBe('missing_field');
    }
  });

  it('exercises every autonomy level AND its absence', () => {
    // The level answers a question a founder actually asks — "will it stop and
    // ask me?" — so `null` must not quietly become SUPERVISED. A fixture set
    // carrying only the levels could not catch that.
    for (const level of WONDERLAND_AUTONOMY_LEVELS) {
      expect(rows.some((r) => r.name === `hydration-autonomy-${level}`), `no fixture for ${level}`)
        .toBe(true);
    }
    expect(rows.some((r) => r.name === 'hydration-autonomy-absent')).toBe(true);
  });

  it('sends all nine Project Brain kinds, and one the kernel might learn next', () => {
    // A missing known bucket is a refusal — Relay sends all nine every time, so
    // an absent one would become a zero indistinguishable from a reported one.
    // An UNKNOWN kind is tolerated instead: refusing would take a world dark the
    // moment Relay grew a tenth kind, which is by far the more expensive
    // failure. It lands in no bucket, and the gap between `entryCount` and the
    // sum of the buckets is the signal that this build is behind.
    const full = JSON.parse(rows.find((r) => r.name === 'hydration-full')!.json) as {
      brain: { kindCounts: Record<string, number> };
    };
    expect(Object.keys(full.brain.kindCounts).sort()).toEqual([...WONDERLAND_BRAIN_KINDS].sort());

    const missing = rows.find((r) => r.name === 'hydration-brain-missing-kind');
    expect(missing!.expect).toBe('missing_field');
    const future = rows.find((r) => r.name === 'hydration-brain-future-kind');
    expect(future, 'no fixture for a kind the kernel learned next').toBeDefined();
    expect(future!.expect, 'a future kind must be TOLERATED, not refused').toBe('ok');
  });

  it('carries no provider or model name, and no credential', () => {
    // The C.A.R.D. is the side door this sweep exists for. `CardVersion` holds
    // provider and model names beside the slots; the scope narrows them away,
    // and a scope that stopped doing so would leak them onto the one surface a
    // player can attach a debugger to.
    const everything = rows.map((r) => r.json).join(' ').toLowerCase();
    for (const name of ['gpt', 'claude', 'openai', 'anthropic', 'hermes', 'xai', 'gemini', 'codex']) {
      expect(everything, `a hydration fixture mentions ${name}`).not.toContain(name);
    }
    expect(everything).not.toContain('apikey');
  });

  it('carries no Project Brain content, only counts about it', () => {
    // The citation's whole design: a world learns THAT context was retrieved
    // and how much of it, never what it said. There is no field on this shape
    // for an entry's text, and this notices if one appears.
    for (const row of rows.filter((r) => r.expect === 'ok')) {
      const brain = (JSON.parse(row.json) as { brain: Record<string, unknown> }).brain;
      for (const [key, value] of Object.entries(brain)) {
        if (typeof value !== 'string') continue;
        expect(value.length, `${row.name}.brain.${key} is long enough to be prose`).toBeLessThan(120);
        expect(value, `${row.name}.brain.${key} contains a sentence`).not.toMatch(/\.\s+[A-Z]/);
      }
    }
  });
});

describe('the hydration fixtures — what a person is being waited on for', () => {
  const rows = readFileSync(join(process.cwd(), WONDERLAND_WIRE_HYDRATIONS_PATH), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, expect_, json] = line.split('\t');
      return { name, expect: expect_, json };
    });

  it('exercises every operation C.A.R.D. can gate', () => {
    // A gate this build cannot name is a person being waited on that a world
    // would not draw — and the run would look merely slow, which is the one
    // failure here that reads as normal. So the vocabulary crosses whole, and
    // each member is exercised rather than assumed present from the enum.
    for (const operation of WONDERLAND_GATED_OPERATIONS) {
      expect(rows.some((r) => r.name === `hydration-gate-${operation}`), `no fixture for ${operation}`)
        .toBe(true);
    }
  });

  it('sends a gate on the RUN as well as one on a task', () => {
    // `taskId` is nullable precisely because C.A.R.D. gates run-level
    // operations, and a decoder that required the id would refuse the gate
    // that stops the whole run.
    const row = rows.find((r) => r.name === 'hydration-gate-run-level');
    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.json) as { humanGates: { taskId: string | null }[] };
    expect(parsed.humanGates[0].taskId).toBeNull();
  });

  it('refuses a gate belonging to another project or another run', () => {
    for (const name of ['hydration-foreign-gate-project', 'hydration-foreign-gate-run']) {
      const row = rows.find((r) => r.name === name);
      expect(row, `no fixture named ${name}`).toBeDefined();
      expect(row!.expect).toBe('identity_rejected');
    }
  });

  it('refuses an operation outside the vocabulary, and the field being absent', () => {
    expect(rows.find((r) => r.name === 'hydration-gate-unknown-operation')!.expect)
      .toBe('unknown_token');
    // A bridge that does not send gates is NOT a run waiting on nobody, and of
    // the two this build must not guess the second.
    expect(rows.find((r) => r.name === 'hydration-gates-absent')!.expect).toBe('missing_field');
    expect(rows.find((r) => r.name === 'hydration-gates-not-an-array')!.expect).toBe('wrong_type');
  });

  it('carries no sentence a person could have written, on any gate', () => {
    // `julius_approvals.safe_rationale` is a real column and a genuinely safe
    // sentence, and it still does not cross. `reasonCode` is the one text field
    // that does, and prose in it is dropped to empty rather than drawn — the
    // fixture below plants a whole sentence and expects nothing.
    const prose = rows.find((r) => r.name === 'hydration-gate-unrepeatable-reason');
    expect(prose).toBeDefined();
    const parsed = JSON.parse(prose!.json) as { humanGates: { reasonCode: string }[] };
    expect(parsed.humanGates[0].reasonCode).toBe('');
    expect(prose!.json).not.toContain('in person');

    for (const row of rows.filter((r) => r.expect === 'ok')) {
      const gates = (JSON.parse(row.json) as { humanGates: Record<string, unknown>[] }).humanGates;
      for (const gate of gates) {
        expect(Object.keys(gate)).not.toContain('safeRationale');
        expect(Object.keys(gate)).not.toContain('decidedBy');
        expect(Object.keys(gate)).not.toContain('decisionReason');
        for (const [key, value] of Object.entries(gate)) {
          if (typeof value !== 'string') continue;
          expect(value.length, `${row.name}.${key} is long enough to be prose`).toBeLessThan(120);
          expect(value, `${row.name}.${key} contains a sentence`).not.toMatch(/\.\s+[A-Z]/);
        }
      }
    }
  });

  it('sends an ungated run beside the gated ones', () => {
    // An empty list beside a KNOWN count of zero is "nothing is gated"; the
    // count is what carries "nobody counted". Without this fixture a decoder
    // that refused empty arrays would pass.
    const row = rows.find((r) => r.name === 'hydration-gate-none');
    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.json) as {
      humanGates: unknown[]; run: { pendingApprovals: number | null };
    };
    expect(parsed.humanGates).toEqual([]);
    expect(parsed.run.pendingApprovals).toBe(0);
  });
});

describe('the hydration fixtures — what a world hydrating cold can draw', () => {
  const rows = readFileSync(join(process.cwd(), WONDERLAND_WIRE_HYDRATIONS_PATH), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, expect_, json] = line.split('\t');
      return { name, expect: expect_, json };
    });

  it('sends a drawable state for every state the kernel can hold', () => {
    // A world hydrating cold has only this. `run.state` is the kernel's
    // bookkeeping word, and mapping it client-side would be a second answer to
    // "what is this run doing" in engine code nobody reviewed — agreeing with
    // Relay's until the day it did not.
    for (const state of JULIUS_MISSION_STATES) {
      const row = rows.find((r) => r.name === `hydration-state-${state}`);
      expect(row, `no fixture for kernel state ${state}`).toBeDefined();
      const parsed = JSON.parse(row!.json) as { visualState: string };
      expect(JULIUS_VISUAL_STATES as readonly string[]).toContain(parsed.visualState);
    }
  });

  it('draws a run that will never send another event', () => {
    // The case the field exists for: a COMPLETED run sends no further events,
    // so the envelope that normally carries the drawable state never arrives.
    const row = rows.find((r) => r.name === 'hydration-terminal-complete');
    const parsed = JSON.parse(row!.json) as { visualState: string; terminal: boolean };
    expect(parsed.visualState).toBe('complete');
    expect(parsed.terminal).toBe(true);
  });

  it('keeps ENDED and HOW IT IS DRAWN on separate axes', () => {
    // `blocked` and `error` are drawn differently and only one is terminal, so
    // the flag cannot be recovered from the picture. A client inferring an
    // ending from the drawing would be reading the picture as the fact — and
    // neither may ever appear as `complete`.
    type Drawn = { visualState: string; terminal: boolean };
    const blocked = JSON.parse(
      rows.find((r) => r.name === 'hydration-blocked-not-terminal')!.json) as Drawn;
    const failed = JSON.parse(
      rows.find((r) => r.name === 'hydration-failed-is-terminal')!.json) as Drawn;
    expect(blocked.visualState).toBe('blocked');
    expect(blocked.terminal).toBe(false);
    expect(failed.visualState).toBe('error');
    expect(failed.terminal).toBe(true);
    expect([blocked.visualState, failed.visualState]).not.toContain('complete');
  });

  it('refuses a picture that does not match its run, and the field being absent', () => {
    expect(rows.find((r) => r.name === 'hydration-picture-disagrees-with-run')!.expect)
      .toBe('unknown_token');
    expect(rows.find((r) => r.name === 'hydration-no-visual-state')!.expect).toBe('missing_field');
    expect(rows.find((r) => r.name === 'hydration-no-terminal-flag')!.expect).toBe('missing_field');
  });
});
