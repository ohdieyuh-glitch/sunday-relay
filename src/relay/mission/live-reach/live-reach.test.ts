import { describe, expect, it } from 'vitest';

import {
  ACTION_OUTCOMES,
  LIVE_REACH_ACTION_CAPABILITIES,
  LIVE_REACH_SOURCES,
  isActionCapability,
  mayFallBackAfter,
  type ActionOutcome,
  type BackendProbe,
  type LiveReachCapability,
  type LiveReachSource,
} from './live-reach-contracts';
import {
  LIVE_REACH_REGISTRY,
  backendCandidates,
  findSource,
  reachableSources,
  resolveReadiness,
  supportedActionCapabilities,
  supportedCapabilities,
} from './live-reach-registry';
import {
  EMPTY_LIVE_REACH_SETTINGS,
  acknowledgeGlobalNotice,
  acknowledgeSourceNotice,
  capabilityState,
  disableAllSources,
  evaluateLiveReach,
  setCapability,
  setGroup,
  shouldShowGlobalNotice,
  shouldShowSourceNotice,
} from './live-reach-permissions';

/**
 * LIVE REACH — the rules that make it honest.
 *
 * Four claims are held here, and each has its own way of quietly stopping to
 * be true:
 *
 *   READY IS OBSERVED.       Configuration is not readiness. A source becomes
 *                            ready only where a probe saw it answer.
 *   FALLBACK IS FOR READS.   A mutation whose result is UNKNOWN is never
 *                            retried on another backend. That is how the same
 *                            post gets published twice.
 *   ENABLED IS NOT AUTHORITY. A capability being switched on does not permit
 *                            an act; the Mission has to ask for it.
 *   NOTHING IS FABRICATED.   No source may advertise a capability no backend
 *                            performs — including every social action, which
 *                            the evaluated project implements none of.
 */

const probe = (
  backendId: string,
  capability: LiveReachCapability,
  result: BackendProbe['result'],
): BackendProbe => ({ backendId, capability, result, probedAt: '2026-08-10T00:00:00.000Z' });

describe('the registry describes only what exists', () => {
  it('models every declared source exactly once', () => {
    expect(LIVE_REACH_REGISTRY.map((s) => s.source).sort())
      .toEqual([...LIVE_REACH_SOURCES].sort());
  });

  it('advertises no capability that no backend performs', () => {
    for (const definition of LIVE_REACH_REGISTRY) {
      for (const capability of supportedCapabilities(definition.source)) {
        const performing = definition.backends.filter((b) => b.operations.includes(capability));
        expect(performing.length, `${definition.source}/${capability}`).toBeGreaterThan(0);
      }
    }
  });

  it('claims NO social action capability anywhere, because none is implemented', () => {
    // The evaluated project implements no write operation of any kind, and
    // Relay has built no action backend yet. Any action appearing here would
    // be a fabricated integration — the specific failure the direction names.
    for (const source of LIVE_REACH_SOURCES) {
      expect(supportedActionCapabilities(source), source).toEqual([]);
    }
    // And the vocabulary still exists, so the day a real one is built there is
    // somewhere honest to put it.
    expect(LIVE_REACH_ACTION_CAPABILITIES.length).toBeGreaterThan(0);
  });

  it('separates the sources Relay can actually reach from the ones it models', () => {
    const reachable = reachableSources().map((s) => s.source);
    expect(reachable).toContain('web');
    expect(reachable).toContain('github');
    // Every unreached source says what it would take, rather than being hidden.
    for (const definition of LIVE_REACH_REGISTRY) {
      if (reachable.includes(definition.source)) continue;
      expect(definition.backends, definition.source).toHaveLength(0);
      expect(definition.accessNote.length, definition.source).toBeGreaterThan(20);
    }
  });

  it('never lets an unreached source be considered ready', () => {
    for (const definition of LIVE_REACH_REGISTRY) {
      if (definition.backends.length > 0) continue;
      // Even handed a probe claiming success for a backend it does not have.
      const readiness = resolveReadiness({
        source: definition.source,
        capability: 'search',
        probes: [probe('anything', 'search', 'observed')],
      });
      expect(readiness, definition.source).toBe('capability_unsupported');
    }
  });
});

describe('ordered backend candidates', () => {
  it('offers the preferred backend first, and the rest as fallbacks', () => {
    const candidates = backendCandidates('github', 'read_item');
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates[0]?.backendId).toBe('relay_github_public');
  });

  it('lets an operator reorder, but never introduce, a backend', () => {
    const reordered = backendCandidates('github', 'read_item', 'relay_http_fetch');
    expect(reordered[0]?.backendId).toBe('relay_http_fetch');
    // An override naming something that cannot serve this capability is
    // IGNORED rather than honoured — a stale override must not be able to
    // hide the backends that work.
    const nonsense = backendCandidates('github', 'read_item', 'no_such_backend');
    expect(nonsense.map((b) => b.backendId))
      .toEqual(backendCandidates('github', 'read_item').map((b) => b.backendId));
  });

  it('offers only backends that perform the capability asked for', () => {
    for (const definition of LIVE_REACH_REGISTRY) {
      for (const capability of supportedCapabilities(definition.source)) {
        for (const backend of backendCandidates(definition.source, capability)) {
          expect(backend.operations, `${backend.backendId}/${capability}`).toContain(capability);
        }
      }
    }
  });
});

describe('READY has to be observed', () => {
  it('is not reached by configuration, only by a probe that saw it answer', () => {
    expect(resolveReadiness({ source: 'github', capability: 'search', probes: [] }))
      .toBe('unknown');
    expect(resolveReadiness({
      source: 'github',
      capability: 'search',
      probes: [probe('relay_github_public', 'search', 'observed')],
    })).toBe('ready');
  });

  it('says UNKNOWN when nothing was asked, never "unavailable"', () => {
    // Nothing has been probed. A deployment that has not looked has not
    // discovered that a source is down.
    expect(resolveReadiness({ source: 'web', capability: 'read_item', probes: [] }))
      .toBe('unknown');
    expect(resolveReadiness({
      source: 'web',
      capability: 'read_item',
      probes: [probe('relay_http_fetch', 'read_item', 'not_probed')],
    })).toBe('unknown');
  });

  it('names the obstacle it actually found', () => {
    const cases: [BackendProbe['result'], string][] = [
      ['unauthenticated', 'authentication_required'],
      ['unconfigured', 'configuration_required'],
      ['unreachable', 'backend_unavailable'],
      ['throttled', 'rate_limited'],
    ];
    for (const [result, expected] of cases) {
      expect(resolveReadiness({
        source: 'web',
        capability: 'read_item',
        probes: [probe('relay_http_fetch', 'read_item', result)],
      }), result).toBe(expected);
    }
  });

  it('lets one working backend beat another that is merely present', () => {
    // The failure Agent Reach's own Twitter channel documents: an installed
    // but unauthenticated backend must not mask a working one behind it.
    expect(resolveReadiness({
      source: 'github',
      capability: 'read_item',
      probes: [
        probe('relay_github_public', 'read_item', 'unauthenticated'),
        probe('relay_http_fetch', 'read_item', 'observed'),
      ],
    })).toBe('ready');
  });

  it('does not let a probe for one capability answer for another', () => {
    expect(resolveReadiness({
      source: 'github',
      capability: 'search',
      probes: [probe('relay_github_public', 'read_item', 'observed')],
    })).toBe('unknown');
  });
});

describe('fallback after an external mutation', () => {
  it('is permitted only when the action provably did not happen', () => {
    const allowed: ActionOutcome[] = ['not_attempted', 'failed_before_action'];
    for (const outcome of ACTION_OUTCOMES) {
      expect(mayFallBackAfter(outcome), outcome).toBe(allowed.includes(outcome));
    }
  });

  it('never falls back on an UNKNOWN result', () => {
    // The whole rule, stated once: the honest answer to "did my post go out?"
    // is that it is unknown. Trying the next backend to find out is how it
    // goes out twice.
    expect(mayFallBackAfter('unknown')).toBe(false);
    expect(mayFallBackAfter('succeeded')).toBe(false);
  });
});

describe('capabilities arrive enabled', () => {
  it('defaults every supported capability ON with no settings at all', () => {
    for (const definition of LIVE_REACH_REGISTRY) {
      for (const capability of supportedCapabilities(definition.source)) {
        const state = capabilityState(definition.source, capability);
        expect(state.enabled, `${definition.source}/${capability}`).toBe(true);
        expect(state.source).toBe('default');
      }
    }
  });

  it('treats an absent setting as the default, not as denial', () => {
    // A project configured before a capability existed inherits the default
    // rather than being denied something nobody declined.
    const settings = setCapability(EMPTY_LIVE_REACH_SETTINGS, 'github', 'search', false);
    expect(capabilityState('github', 'search', settings).enabled).toBe(false);
    expect(capabilityState('github', 'read_item', settings).enabled).toBe(true);
    expect(capabilityState('github', 'read_item', settings).source).toBe('default');
  });

  it('never enables a capability no backend performs', () => {
    const state = capabilityState('web', 'post');
    expect(state.supported).toBe(false);
    expect(state.enabled).toBe(false);
  });
});

describe('the switches resolve narrowest-last', () => {
  it('lets the master switch turn everything off', () => {
    const off = setGroup(EMPTY_LIVE_REACH_SETTINGS, 'github', 'integration', false);
    expect(capabilityState('github', 'search', off).enabled).toBe(false);
    expect(capabilityState('github', 'search', off).source).toBe('integration');
  });

  it('lets read and actions be controlled separately', () => {
    const readOff = setGroup(EMPTY_LIVE_REACH_SETTINGS, 'web', 'read', false);
    expect(capabilityState('web', 'read_item', readOff).enabled).toBe(false);
    // Turning reads off must not disturb the action group, even where no
    // action backend exists yet — the two are independent by construction.
    expect(capabilityState('web', 'read_item', setGroup(readOff, 'web', 'actions', true)).enabled)
      .toBe(false);
  });

  it('lets one capability override its group', () => {
    let settings = setGroup(EMPTY_LIVE_REACH_SETTINGS, 'github', 'read', false);
    settings = setCapability(settings, 'github', 'search', true);
    expect(capabilityState('github', 'search', settings).enabled).toBe(true);
    expect(capabilityState('github', 'search', settings).source).toBe('capability');
    expect(capabilityState('github', 'read_item', settings).enabled).toBe(false);
  });

  it('disables every source with one control, as a real write', () => {
    const all = disableAllSources(EMPTY_LIVE_REACH_SETTINGS, [...LIVE_REACH_SOURCES]);
    for (const definition of LIVE_REACH_REGISTRY) {
      for (const capability of supportedCapabilities(definition.source)) {
        expect(capabilityState(definition.source, capability, all).enabled).toBe(false);
      }
    }
  });
});

describe('a request is refused for the reason that is actually true', () => {
  const base = { capability: 'read_item' as LiveReachCapability, missionAuthorises: true, ready: true };

  it('allows a supported, enabled, ready, authorised read', () => {
    const decision = evaluateLiveReach({ source: 'web', ...base });
    expect(decision.allowed).toBe(true);
  });

  it('refuses a source that does not exist', () => {
    const decision = evaluateLiveReach({ source: 'myspace', ...base });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('source_unknown');
  });

  it('refuses a capability no backend performs', () => {
    const decision = evaluateLiveReach({ source: 'web', ...base, capability: 'post' });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('capability_unsupported');
  });

  it('names WHICH switch turned it off', () => {
    const integration = evaluateLiveReach({
      source: 'web', ...base,
      settings: setGroup(EMPTY_LIVE_REACH_SETTINGS, 'web', 'integration', false),
    });
    if (!integration.allowed) expect(integration.refusal).toBe('integration_disabled');

    const read = evaluateLiveReach({
      source: 'web', ...base,
      settings: setGroup(EMPTY_LIVE_REACH_SETTINGS, 'web', 'read', false),
    });
    if (!read.allowed) expect(read.refusal).toBe('read_disabled');

    const one = evaluateLiveReach({
      source: 'web', ...base,
      settings: setCapability(EMPTY_LIVE_REACH_SETTINGS, 'web', 'read_item', false),
    });
    if (!one.allowed) expect(one.refusal).toBe('capability_disabled');
  });

  it('refuses when the capability was never observed working', () => {
    const decision = evaluateLiveReach({ source: 'web', ...base, ready: false });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('not_ready');
  });

  it('refuses when the Mission did not ask for it, even though it is enabled', () => {
    // The distinction the direction insists on. "Find five customers and draft
    // outreach" enables nothing to be sent.
    const decision = evaluateLiveReach({ source: 'web', ...base, missionAuthorises: false });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.refusal).toBe('mission_does_not_authorize');
      expect(decision.detail).toContain('did not ask for it');
    }
  });
});

describe('the first-entry notices', () => {
  it('shows the global notice once, then never again', () => {
    expect(shouldShowGlobalNotice(EMPTY_LIVE_REACH_SETTINGS)).toBe(true);
    const acknowledged = acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T00:00:00.000Z');
    expect(shouldShowGlobalNotice(acknowledged)).toBe(false);
  });

  it('acknowledges each source separately from the global notice and from each other', () => {
    let settings = acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T00:00:00.000Z');
    expect(shouldShowSourceNotice('github', settings)).toBe(true);
    settings = acknowledgeSourceNotice(settings, 'github', '2026-08-10T00:01:00.000Z');
    expect(shouldShowSourceNotice('github', settings)).toBe(false);
    expect(shouldShowSourceNotice('web', settings)).toBe(true);
  });

  it('keeps acknowledgement separate from capability settings', () => {
    // Acknowledging a notice must never be mistaken for changing a setting.
    const settings = acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T00:00:00.000Z');
    expect(capabilityState('web', 'read_item', settings).source).toBe('default');
  });
});

describe('the vocabulary itself', () => {
  it('classifies read and action capabilities without overlap', () => {
    for (const capability of LIVE_REACH_ACTION_CAPABILITIES) {
      expect(isActionCapability(capability), capability).toBe(true);
    }
    expect(isActionCapability('search')).toBe(false);
    expect(isActionCapability('read_item')).toBe(false);
  });

  it('gives every source a definition a surface can render', () => {
    for (const source of LIVE_REACH_SOURCES as readonly LiveReachSource[]) {
      const definition = findSource(source);
      expect(definition, source).not.toBeNull();
      expect(definition?.displayName.length).toBeGreaterThan(0);
    }
  });
});
