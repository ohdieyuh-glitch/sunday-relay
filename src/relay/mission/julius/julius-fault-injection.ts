/**
 * CONTROLLED FAILURE AT A NAMED BOUNDARY.
 *
 * WHAT THIS IS FOR. "The runtime recovers" is a claim about what happens when
 * a process dies at a specific instant — after the claim and before the
 * dispatch, after the provider answered and before the result was accepted,
 * after the evidence landed and before verification ran. Those instants are
 * exactly the transaction boundaries, and a test cannot reach them by waiting;
 * it has to CAUSE them.
 *
 * This wraps a store so a named method throws on its Nth call. Every other
 * method passes straight through, so a scenario fails at one boundary and is
 * otherwise the real runtime — which is what makes the state it lands in
 * evidence about the runtime rather than about the harness.
 *
 * WHAT A PASS HERE IS EVIDENCE ABOUT. The runtime's logic, and not PostgreSQL.
 * A real database failure can also roll back a transaction that this model
 * treats as committed; the header of `julius-memory-store.ts` states that
 * limit and this inherits it. What it does prove is the property that matters
 * most and is hardest to get right: that after a failure at any boundary, a
 * restart reaches a deterministic state and nothing is executed twice.
 *
 * IT IS A TEST INSTRUMENT. It is exported from the Julius barrel because the
 * chaos suite is a first-class part of the runtime's contract, and it must
 * never be mounted in a deployment: a store that throws on schedule is not a
 * store.
 */

export interface JuliusFaultPlan {
  /** The method to fail on. Any other method is untouched. */
  readonly method: string;
  /** Fail on this call number, counting from 1. */
  readonly onCall: number;
  /** The error thrown. Defaults to a generic boundary failure. */
  readonly error?: Error;
}

export interface JuliusFaultReport {
  /** How many times each wrapped method was called. */
  calls(method: string): number;
  /** Whether the planned fault actually fired. A plan that never fires is a
   *  test that proved nothing, and saying so is the point. */
  readonly fired: boolean;
}

/**
 * Wrap a store so one method fails once, at a chosen call.
 *
 * The wrapper counts EVERY call, including the one that throws, so a test can
 * assert both that the boundary was reached and that the retry after it did
 * not re-enter the same call twice.
 */
export function injectJuliusFault<T extends object>(
  store: T,
  plan: JuliusFaultPlan,
): { store: T; report: JuliusFaultReport } {
  const counts = new Map<string, number>();
  let fired = false;

  const proxied = new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      return (...args: unknown[]) => {
        const next = (counts.get(property) ?? 0) + 1;
        counts.set(property, next);
        if (property === plan.method && next === plan.onCall) {
          fired = true;
          // Thrown SYNCHRONOUSLY from an async method's call site, which is
          // what a connection dropping mid-statement looks like to a caller:
          // the returned promise rejects and nothing downstream ran.
          return Promise.reject(plan.error ?? new Error(`fault_injected:${property}`));
        }
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as T;

  return {
    store: proxied,
    report: {
      calls: (method) => counts.get(method) ?? 0,
      get fired() { return fired; },
    },
  };
}
