import { describe, expect, it } from 'vitest';

import {
  ADAPTER_VERBS,
  OPERATIONAL_VERBS,
  checkVerb,
  findDeclaration,
  operatorPromises,
  reconcileDeclaration,
  supportsVerb,
  type AdapterCapabilityDeclaration,
} from './adapter-lifecycle';
import { RELAY_ADAPTER_DECLARATIONS } from './adapter-declarations';

/**
 * A DECLARATION IS A CLAIM, SO IT IS CHECKED.
 *
 * The point of naming ten verbs is to stop a surface offering one an adapter
 * does not have — a cancel button over something that cannot stop, a spend cap
 * over something that reports no usage. That only works if the declarations
 * are true, which is why the interesting test here is the reconciliation: both
 * a declared verb with no handler and a handler nobody declared are defects,
 * and the second is the easier one to create without noticing.
 */

const declaration = (over: Partial<AdapterCapabilityDeclaration> = {}): AdapterCapabilityDeclaration => ({
  adapterId: 'test_adapter',
  displayName: 'Test adapter',
  verbs: ['readiness', 'execute'],
  absenceNotes: {},
  ...over,
});

describe('asking for a verb', () => {
  it('allows a declared verb', () => {
    expect(checkVerb(declaration(), 'execute').ok).toBe(true);
  });

  it('refuses an undeclared verb, and repeats the reason when one was given', () => {
    const verdict = checkVerb(declaration({
      absenceNotes: { resume: 'No server-side session is held.' },
    }), 'resume');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.refusal).toBe('verb_unsupported');
      // A caller learns WHY, not only that — otherwise they go looking for a
      // flag that was never written.
      expect(verdict.detail).toContain('No server-side session');
    }
  });

  it('still refuses, with a plain reason, when no note was written', () => {
    const verdict = checkVerb(declaration(), 'stop');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.detail).toContain('does not implement stop');
  });

  it('refuses an adapter that is not registered rather than a nearest match', () => {
    const verdict = checkVerb(null, 'execute');
    if (verdict.ok) throw new Error('an unknown adapter was allowed');
    expect(verdict.refusal).toBe('adapter_unknown');
  });
});

describe('what an operator may promise', () => {
  it('reports cancellable only when the adapter can stop', () => {
    expect(operatorPromises(declaration({ verbs: ['stop'] })).cancellable).toBe(true);
    expect(operatorPromises(declaration({ verbs: ['execute'] })).cancellable).toBe(false);
  });

  it('reports budgetable only when the adapter reports usage', () => {
    // A spend cap over an adapter that reports no usage is a hope, not a cap.
    expect(operatorPromises(declaration({ verbs: ['usage'] })).budgetable).toBe(true);
    expect(operatorPromises(declaration({ verbs: ['execute'] })).budgetable).toBe(false);
  });

  it('lists the operational verbs an adapter is missing', () => {
    const promises = operatorPromises(declaration({ verbs: ['execute'] }));
    expect([...promises.missing].sort()).toEqual([...OPERATIONAL_VERBS].sort());
  });

  it('reports nothing missing for an adapter that has them all', () => {
    expect(operatorPromises(declaration({ verbs: [...ADAPTER_VERBS] })).missing).toEqual([]);
  });
});

describe('a declaration is reconciled against real handlers', () => {
  it('accepts a declaration whose verbs all have handlers', () => {
    expect(reconcileDeclaration(declaration(), ['readiness', 'execute'])).toEqual([]);
  });

  it('rejects a declared verb with no handler — a fabricated capability', () => {
    const problems = reconcileDeclaration(declaration({ verbs: ['readiness', 'resume'] }), ['readiness']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.ok).toBe(false);
    if (!problems[0]?.ok) expect(problems[0]?.detail).toContain('implements no handler');
  });

  it('rejects a handler nobody declared', () => {
    // Reachable by accident, never by policy, and invisible to every surface
    // that reads the declaration.
    const problems = reconcileDeclaration(declaration(), ['readiness', 'execute', 'stop']);
    expect(problems).toHaveLength(1);
    if (!problems[0]?.ok) {
      expect(problems[0]?.refusal).toBe('verb_undeclared_handler');
      expect(problems[0]?.detail).toContain('declares it nowhere');
    }
  });

  it('ignores handlers that are not verbs at all', () => {
    // An adapter has methods of its own; only the ten verbs are Relay's
    // business, and complaining about the rest would make the check noise.
    expect(reconcileDeclaration(declaration(), ['readiness', 'execute', 'somePrivateHelper']))
      .toEqual([]);
  });
});

describe('the shipped declarations', () => {
  it('name adapters that exist, once each', () => {
    const ids = RELAY_ADAPTER_DECLARATIONS.map((entry) => entry.adapterId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('claude_code_local');
    expect(ids).toContain('hermes_remote_service');
  });

  it('declare only verbs from the vocabulary', () => {
    for (const entry of RELAY_ADAPTER_DECLARATIONS) {
      for (const verb of entry.verbs) {
        expect(ADAPTER_VERBS, `${entry.adapterId}/${verb}`).toContain(verb);
      }
    }
  });

  it('explain an absence wherever an operator would ask about it', () => {
    // Not every absence needs a sentence, but the operational ones do: those
    // are the four that change what a surface may offer.
    for (const entry of RELAY_ADAPTER_DECLARATIONS) {
      for (const verb of OPERATIONAL_VERBS) {
        if (supportsVerb(entry, verb)) continue;
        expect(entry.absenceNotes[verb], `${entry.adapterId} is silent about missing ${verb}`)
          .toBeDefined();
      }
    }
  });

  it('never writes an absence note for a verb it declares', () => {
    // A note explaining why something is missing, beside a claim that it is
    // present, is one of the two being wrong.
    for (const entry of RELAY_ADAPTER_DECLARATIONS) {
      for (const verb of entry.verbs) {
        expect(entry.absenceNotes[verb], `${entry.adapterId} both declares and excuses ${verb}`)
          .toBeUndefined();
      }
    }
  });

  it('reports the hosted SDK as not cancellable, because it is not', () => {
    const hosted = findDeclaration(RELAY_ADAPTER_DECLARATIONS, 'claude_agent_sdk_hosted');
    expect(hosted).not.toBeNull();
    const promises = operatorPromises(hosted as AdapterCapabilityDeclaration);
    expect(promises.cancellable).toBe(false);
    // And says why, so nobody builds a cancel button over it.
    expect(hosted?.absenceNotes.stop).toContain('nothing to cancel');
  });

  it('reports the local reviewer as unbudgetable rather than estimating usage', () => {
    const local = findDeclaration(RELAY_ADAPTER_DECLARATIONS, 'hermes_local');
    expect(operatorPromises(local as AdapterCapabilityDeclaration).budgetable).toBe(false);
    expect(local?.absenceNotes.usage).toContain('rather than estimating');
  });

  it('returns null for an adapter that is not there', () => {
    expect(findDeclaration(RELAY_ADAPTER_DECLARATIONS, 'no_such_adapter')).toBeNull();
  });
});
