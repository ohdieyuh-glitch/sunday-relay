import { useEffect, useRef } from 'react';
import './relay-loop.css';
import { RELAY_LOOP_TARGETABLE_ROLES, RELAY_LOOP_CANONICAL_ALIAS } from '../../mission';

/**
 * THE LOOP OVERVIEW — what `/loops` opens.
 *
 * Five sections, four of which are empty and say WHY rather than showing a
 * spinner or a zero. "No Loops yet" and "Loops cannot be stored yet" are
 * different facts, and a user deciding whether to trust this surface needs the
 * second one.
 *
 * NO FIXTURES HERE. Development fixtures are never rendered by this component
 * in a production path; a test that wants populated sections passes its own
 * data and labels it. An overview that shows invented Loops would teach the
 * user that Loops exist.
 */

export interface RelayLoopOverviewSection {
  readonly id: string;
  readonly title: string;
  /** Items, when there are any. Empty is the normal case in this build. */
  readonly items: readonly { readonly id: string; readonly primary: string; readonly secondary: string }[];
  /** Why the section is empty. Shown when `items` is empty. */
  readonly emptyReason: string;
  /** True when the section cannot be populated at all yet, as opposed to
   *  being populated-but-empty. Rendered differently, because they mean
   *  different things. */
  readonly unavailable: boolean;
  /** Set only when items are development fixtures, which must say so. */
  readonly fixtureLabel?: string;
}

/**
 * The truthful default sections for this build.
 *
 * Every one is unavailable, because nothing persists Loops yet. Stating that
 * per-section — rather than once at the top — means each section stays honest
 * on its own as the runtime lands section by section.
 */
export const RELAY_LOOP_OVERVIEW_SECTIONS: readonly RelayLoopOverviewSection[] = Object.freeze([
  Object.freeze({
    id: 'draft',
    title: 'DRAFT LOOPS',
    items: [],
    emptyReason:
      'Draft Loops are not stored yet. A drafted contract lives only in the composer you are looking at.',
    unavailable: true,
  }),
  Object.freeze({
    id: 'active',
    title: 'ACTIVE LOOPS',
    items: [],
    emptyReason: 'Loop execution is not implemented in this build. No Loop has ever run.',
    unavailable: true,
  }),
  Object.freeze({
    id: 'scheduled',
    title: 'SCHEDULED LOOPS',
    items: [],
    emptyReason:
      'The Cron grammar is understood, but the scheduler is not enabled. Nothing is scheduled and nothing will fire.',
    unavailable: true,
  }),
  Object.freeze({
    id: 'templates',
    title: 'TEMPLATES',
    items: [],
    emptyReason: 'Loop templates are not implemented yet. PSP Agents will define them.',
    unavailable: true,
  }),
  Object.freeze({
    id: 'history',
    title: 'RECENT LOOP HISTORY',
    items: [],
    emptyReason: 'There is no history because no Loop has run.',
    unavailable: true,
  }),
]) as readonly RelayLoopOverviewSection[];

export function RelayLoopOverview({
  sections = RELAY_LOOP_OVERVIEW_SECTIONS,
  onClose,
  onStartComposer,
}: {
  sections?: readonly RelayLoopOverviewSection[];
  onClose: () => void;
  onStartComposer: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      className="rlo"
      role="dialog"
      aria-modal="false"
      aria-labelledby="rlo-heading"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header className="rlo-head">
        <h2 className="rlo-title" id="rlo-heading" ref={headingRef} tabIndex={-1}>
          LOOPS
        </h2>
        <button type="button" className="rlc-btn" onClick={onClose}>
          Close
        </button>
      </header>

      <p className="rlo-lede">
        A Loop is persistent compound-agent work. Today Relay understands Loop commands and can
        draft a contract for review. Persistent execution is not implemented, so every section
        below says what it can and cannot yet hold.
      </p>

      <p className="rlo-capability">
        <span className="rlo-capability-label">AVAILABLE ROLES</span>
        {RELAY_LOOP_TARGETABLE_ROLES.map((role) => RELAY_LOOP_CANONICAL_ALIAS[role]).join(', ')}
      </p>

      {sections.map((section) => (
        <section className="rlo-section" key={section.id} aria-labelledby={`rlo-${section.id}`}>
          <h3 className="rlc-section-title" id={`rlo-${section.id}`}>
            {section.title}
            {section.unavailable ? <span className="rlo-tag">NOT AVAILABLE YET</span> : null}
          </h3>
          {section.fixtureLabel !== undefined ? (
            <p className="rlo-fixture">{section.fixtureLabel}</p>
          ) : null}
          {section.items.length === 0 ? (
            <p className="rlo-empty">{section.emptyReason}</p>
          ) : (
            <ul className="rlo-items">
              {section.items.map((item) => (
                <li key={item.id}>
                  <span className="rlo-item-primary">{item.primary}</span>
                  <span className="rlo-item-secondary">{item.secondary}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <footer className="rlo-actions">
        <button type="button" className="rlc-btn rlc-btn--primary" onClick={onStartComposer}>
          Start a Loop
        </button>
        <span className="rlc-why">Opens the composer. Nothing runs and nothing is spent.</span>
      </footer>
    </section>
  );
}
