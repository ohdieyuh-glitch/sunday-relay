/**
 * THE VERBS AN ADAPTER MAY BE ASKED FOR, and which ones it actually has.
 *
 * Relay's connector ports declare one verb per role — `createBlueprint`,
 * `dispatch`, `review` — plus a descriptor. That is enough to run a mission
 * and not enough to operate one: an operator asking "can this thing resume?"
 * or "what did it cost?" has no contract to ask through, and each connector
 * grew its own answer or none.
 *
 * This is the missing vocabulary, and it is deliberately ONLY a vocabulary.
 * It runs nothing. An adapter DECLARES which verbs it implements and Relay
 * refuses the rest — because the alternative is the failure this codebase
 * keeps meeting: a surface that offers `resume` on an adapter that cannot
 * resume, discovered at the moment someone needed it.
 *
 * DECLARED IS NOT IMPLEMENTED. A declaration is a claim, and a claim without a
 * handler is exactly the fabricated capability this product refuses. So the
 * declaration and the handlers are checked against each other rather than
 * trusted — `adapter-lifecycle.test.ts` fails a declaration naming a verb it
 * cannot perform, and fails a handler nobody declared.
 *
 * Pure: no clock, no network, no Node.
 */

export const ADAPTER_VERBS = [
  /** Can this adapter run at all, here, now? Side-effect free. */
  'readiness',
  /** Begin a unit of work. Returns a handle, not a result. */
  'start',
  /** Run to completion in one call. The simple case. */
  'execute',
  /** Incremental output while work is in flight. */
  'stream',
  /** Continue work that was interrupted, by handle. */
  'resume',
  /** Ask it to stop, and find out whether it did. */
  'stop',
  /** Fetch the outcome of started work. */
  'result',
  /** What it consumed: tokens, calls, money. */
  'usage',
  /** WHO actually answered — never who was requested. */
  'identity',
  /** What it says it can do. */
  'capabilities',
] as const;
export type AdapterVerb = (typeof ADAPTER_VERBS)[number];

/**
 * Verbs whose absence changes what an operator may promise.
 *
 * An adapter that cannot `stop` cannot be cancelled, and a surface offering a
 * cancel button over it is lying. An adapter that cannot report `usage` cannot
 * be budgeted, and a spend cap over it is a hope. Naming these separately is
 * what lets a caller ask the question that matters rather than reading a list.
 */
export const OPERATIONAL_VERBS: readonly AdapterVerb[] = Object.freeze([
  'stop', 'usage', 'identity', 'readiness',
]);

export interface AdapterCapabilityDeclaration {
  readonly adapterId: string;
  readonly displayName: string;
  /** Verbs this adapter implements. Everything else is refused. */
  readonly verbs: readonly AdapterVerb[];
  /**
   * Why a verb is absent, where the absence is worth explaining.
   *
   * A one-shot CLI cannot resume because it holds no server-side session, and
   * saying that is more useful than an unexplained gap — an operator reading
   * it stops looking for a flag that does not exist.
   */
  readonly absenceNotes: Readonly<Partial<Record<AdapterVerb, string>>>;
}

export const ADAPTER_REFUSALS = [
  'adapter_unknown',
  'verb_unsupported',
  'verb_undeclared_handler',
] as const;
export type AdapterRefusal = (typeof ADAPTER_REFUSALS)[number];

export type VerbVerdict =
  | { readonly ok: true; readonly verb: AdapterVerb }
  | { readonly ok: false; readonly refusal: AdapterRefusal; readonly detail: string };

/** Whether this adapter implements a verb. Declaration only — see the header. */
export function supportsVerb(
  declaration: AdapterCapabilityDeclaration,
  verb: AdapterVerb,
): boolean {
  return declaration.verbs.includes(verb);
}

/**
 * May this verb be asked of this adapter?
 *
 * Refuses with the reason, and repeats the absence note where one exists, so a
 * caller learns why rather than only that.
 */
export function checkVerb(
  declaration: AdapterCapabilityDeclaration | null,
  verb: AdapterVerb,
): VerbVerdict {
  if (declaration === null) {
    return { ok: false, refusal: 'adapter_unknown', detail: 'No such adapter is registered.' };
  }
  if (!supportsVerb(declaration, verb)) {
    const note = declaration.absenceNotes[verb];
    return {
      ok: false,
      refusal: 'verb_unsupported',
      detail: note ?? `${declaration.displayName} does not implement ${verb}.`,
    };
  }
  return { ok: true, verb };
}

/**
 * What an operator may promise over this adapter.
 *
 * Derived from the declaration rather than assumed, because every one of these
 * has been assumed somewhere and been wrong: a cancel button over an adapter
 * that cannot stop, a spend cap over one that reports no usage.
 */
export interface OperatorPromises {
  readonly cancellable: boolean;
  readonly budgetable: boolean;
  readonly attributable: boolean;
  readonly probeable: boolean;
  /** Verbs missing that an operator would have wanted. */
  readonly missing: readonly AdapterVerb[];
}

export function operatorPromises(
  declaration: AdapterCapabilityDeclaration,
): OperatorPromises {
  return {
    cancellable: supportsVerb(declaration, 'stop'),
    budgetable: supportsVerb(declaration, 'usage'),
    attributable: supportsVerb(declaration, 'identity'),
    probeable: supportsVerb(declaration, 'readiness'),
    missing: Object.freeze(OPERATIONAL_VERBS.filter((verb) => !supportsVerb(declaration, verb))),
  };
}

/**
 * Check a declaration against the handlers an adapter actually exposes.
 *
 * BOTH DIRECTIONS. A declared verb with no handler is a fabricated capability.
 * A handler nobody declared is a capability Relay cannot see — reachable by
 * accident, never by policy, and invisible to every surface that reads the
 * declaration. Neither is acceptable and the second is the easier one to
 * create without noticing.
 */
export function reconcileDeclaration(
  declaration: AdapterCapabilityDeclaration,
  handlerNames: readonly string[],
): readonly VerbVerdict[] {
  const problems: VerbVerdict[] = [];
  const handlers = new Set(handlerNames);

  for (const verb of declaration.verbs) {
    if (!handlers.has(verb)) {
      problems.push({
        ok: false,
        refusal: 'verb_unsupported',
        detail: `${declaration.adapterId} declares ${verb} and implements no handler for it.`,
      });
    }
  }
  for (const name of handlerNames) {
    if ((ADAPTER_VERBS as readonly string[]).includes(name)
      && !declaration.verbs.includes(name as AdapterVerb)) {
      problems.push({
        ok: false,
        refusal: 'verb_undeclared_handler',
        detail: `${declaration.adapterId} implements ${name} and declares it nowhere, so nothing can offer it.`,
      });
    }
  }
  return Object.freeze(problems);
}

/** Look one up. Unknown is null — never the nearest adapter. */
export function findDeclaration(
  catalogue: readonly AdapterCapabilityDeclaration[],
  adapterId: string,
): AdapterCapabilityDeclaration | null {
  return catalogue.find((entry) => entry.adapterId === adapterId) ?? null;
}
