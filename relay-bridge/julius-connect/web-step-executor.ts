import type { ConnectStepExecutor } from '../../src/relay/mission/julius-connect';
import type { LiveBrowser } from './live-browser';

/**
 * JULIUS WORKING ON THE REAL WEB — the step runner behind the `open-web` connector.
 *
 * FOUNDER DIRECTION (2026-09-17): "it should not be a simulation should be real."
 *
 * Every step here is a real browser doing a real thing on a real site: opening a page, reading what it says, typing into
 * the site's own search box. The gate decides first, every time -- this runs only for a step the domain allowed, and a
 * connection revoked mid-task stops the step after it.
 *
 * WHY IT ANSWERS "PENDING". Real work takes longer than a tick. The first time a step comes round the work is started and
 * the runner says `pending`, so nothing is recorded for an unfinished step; when it finishes, the next tick gets the real
 * outcome and the domain records that. It also means the gate is asked again while the work is in flight.
 *
 * WHAT IT WILL NOT DO. It navigates only through the browser's allowlist, never signs in as anyone, and never buys
 * anything: `web.sign_in` and `web.purchase` exist on the connector so the prompt can show they are not asked for.
 */

/** The browser tab Julius works in, which Wonderland watches so the founder sees the same page Julius does. */
export const JULIUS_WEB_TAB = 'julius';

type StepResult = { readonly outcome: 'success' | 'failed'; readonly detail: string };

export function createWebStepExecutor(browser: LiveBrowser, tabId: string = JULIUS_WEB_TAB): ConnectStepExecutor {
  const done = new Map<string, StepResult>();
  const working = new Set<string>();

  const run = async (op: string, url: string | undefined, query: string | undefined, label: string): Promise<StepResult> => {
    if (op === 'navigate') {
      const result = await browser.navigate(tabId, url ?? '');
      return result.ok
        ? { outcome: 'success', detail: `Julius opened ${result.host} in the governed browser.` }
        : { outcome: 'failed', detail: `Julius could not open it: ${result.refusal}` };
    }
    if (op === 'read') {
      const page = await browser.read(tabId);
      if (page === null) {
        return { outcome: 'failed', detail: 'There is no page open to read.' };
      }
      // WHAT THE PAGE ACTUALLY SAID, shortened. It is a public page Julius was allowed to open, and the founder is
      // watching the same page in Wonder Web.
      const said = page.text.slice(0, 200);
      return { outcome: 'success', detail: `Julius read "${page.title}": ${said}${page.text.length > 200 ? '…' : ''}` };
    }
    if (op === 'search') {
      const result = await browser.searchOnPage(tabId, query ?? '');
      return result.ok
        ? { outcome: 'success', detail: `Julius searched the site for "${query ?? ''}" using its own search box.` }
        : { outcome: 'failed', detail: `Julius could not search there: ${result.refusal}` };
    }
    return { outcome: 'failed', detail: `Julius does not know how to: ${label}` };
  };

  return ({ step, task }) => {
    const key = `${task.taskId}:${task.cursor}`;
    const finished = done.get(key);
    if (finished !== undefined) {
      done.delete(key);
      return finished;
    }
    if (step.action === undefined) {
      return { outcome: 'failed', detail: `${step.label} has nothing for the browser to do.` };
    }
    if (!working.has(key)) {
      working.add(key);
      void run(step.action.op, step.action.url, step.action.query, step.label)
        .catch((error: unknown) => ({ outcome: 'failed' as const, detail: `The browser did not manage it: ${String(error).slice(0, 120)}` }))
        .then((result) => {
          done.set(key, result);
          working.delete(key);
        });
    }
    return { outcome: 'pending', detail: `Julius is working on: ${step.label}` };
  };
}
