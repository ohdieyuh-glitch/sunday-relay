import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type {
  HarnessCatalogEntryView, ReviewerHarnessCatalogView,
} from '../../mission/reviewer-harness';

/**
 * SUNDAY RELAY — THE REVIEWER HARNESS CATALOG SURFACE.
 *
 * The browser projection of the ONE canonical catalog. It is opened from the
 * Reviewer panel — in the workspace and in the Reviewer fullscreen view alike,
 * because the panel never leaves the React tree when it is focused.
 *
 * IT OWNS NO CATALOG. Every name, maturity, adapter state, installation state,
 * capability and reason below is read from `projectHarnessCatalog()`, the same
 * call `relay reviewer harnesses` renders. This component chooses layout; the
 * projection chooses truth, so the two surfaces cannot word a harness
 * differently and a claim cannot be introduced by a React file.
 *
 * IT CANNOT START ANYTHING. There is no start affordance and no provider path
 * here: a row is a thing to INSPECT. Rows that the domain says are not
 * startable carry `aria-disabled` plus the reason, and activating one only
 * expands its detail — it never touches identity, never mints a run, never
 * records usage and never opens a connection. That is asserted directly in
 * `reviewer-harness-catalog-ui.test.tsx` rather than left to review.
 *
 * A CONNECTED HARNESS LATER slots into this same surface: startability is
 * already a domain field, so the row simply stops being disabled. Nothing here
 * has to be replaced to get there.
 */

/** Everything focusable inside the sheet, for containment. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function RelayReviewerHarnessCatalog({
  open,
  view,
  onClose,
  returnFocusTo,
  onInspectUnavailable,
}: {
  open: boolean;
  view: ReviewerHarnessCatalogView;
  onClose: () => void;
  /** The trigger to restore focus to, so focus never lands on <body>. */
  returnFocusTo?: HTMLElement | null;
  /**
   * Optional, and deliberately narrow: the ONE application notification host
   * may say a harness is unavailable. It is called at most once per opening,
   * so inspecting several unavailable rows cannot produce a stack of toasts.
   */
  onInspectUnavailable?: (harnessName: string) => void;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const announcedRef = useRef(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const titleId = useId();
  const idBase = useId();

  useEffect(() => {
    if (!open) return undefined;
    // The background must not scroll behind the sheet — the same rule the
    // Usage detail panel and the focused-panel shell already apply.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus?.();
    };
  }, [open, returnFocusTo]);

  // One announcement per opening, reset when the sheet closes.
  useEffect(() => {
    if (!open) {
      announcedRef.current = false;
      setExpandedId(null);
    }
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        // Escape closes the TOPMOST surface: a focused Reviewer panel behind
        // this sheet must not also collapse.
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // Containment, and the same stop: while the sheet is open it owns Tab,
      // so the focused panel behind it never re-handles the key.
      event.stopPropagation();
      const nodes = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    },
    [onClose],
  );

  /**
   * THE ONLY THING ACTIVATING A ROW DOES. It toggles that row's detail, and —
   * for an unavailable harness, once per opening — asks the shared host to say
   * so. It starts nothing, selects nothing and connects nothing.
   */
  const onEntryActivate = useCallback(
    (entry: HarnessCatalogEntryView) => {
      setExpandedId((current) => (current === entry.catalogId ? null : entry.catalogId));
      if (entry.startable) return;
      if (announcedRef.current) return;
      announcedRef.current = true;
      onInspectUnavailable?.(entry.name);
    },
    [onInspectUnavailable],
  );

  if (!open) return null;

  return (
    <div className="rhc-overlay" data-relay-harness-catalog="true">
      <section
        className="rhc-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="rhc-head">
          <h2 className="rhc-title" id={titleId}>Reviewer Harness</h2>
          <button
            type="button"
            ref={closeRef}
            className="rhc-close"
            onClick={onClose}
            aria-label="Close Reviewer Harness catalog"
          >
            CLOSE
          </button>
        </header>

        {/* Simulated or fixture activity discloses itself BEFORE any figure. */}
        {view.disclosure !== null && (
          <p className="rhc-disclosure" role="note">{view.disclosure}</p>
        )}

        {/* ---------------------------- current reviewer status ---------- */}
        <section className="rhc-status" aria-label="Current Reviewer status">
          <p className="rhc-status-label" data-harness-status="true">{view.statusLabel}</p>
          <p className="rhc-status-detail">{view.statusDetail}</p>
          {/* Five INDEPENDENT rows. Requested never fills in actual, and an
              intended future harness or model is not displayed as either. */}
          <dl className="rhc-identity">
            {view.identityRows.map((row) => (
              <div className="rhc-identity-row" key={row.key} data-identity={row.key}>
                <dt className="rhc-key">{row.label}</dt>
                <dd className="rhc-value">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="rhc-independence">
            <span className="rhc-key">Independence</span>
            <span className="rhc-value" data-independence="true">{view.independenceLabel}</span>
            <span className="rhc-key">Providers</span>
            <span className="rhc-value">{view.providerDiversityLabel}</span>
          </p>
          <ul className="rhc-reasons">
            {view.independenceReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </section>

        {/* ------------------------------------------- the catalog ------- */}
        <h3 className="rhc-subtitle">{view.title}</h3>
        <p className="rhc-count">{view.countLabel}</p>

        <ul className="rhc-entries">
          {view.entries.map((entry) => {
            const expanded = expandedId === entry.catalogId;
            const detailId = `${idBase}-${entry.catalogId}-detail`;
            const reasonId = `${idBase}-${entry.catalogId}-reason`;
            return (
              <li
                className="rhc-entry"
                key={entry.catalogId}
                data-catalog-id={entry.catalogId}
                data-startable={entry.startable ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className="rhc-entry-btn"
                  // NOT `disabled`: an unavailable harness must still be
                  // inspectable by keyboard. `aria-disabled` announces that it
                  // cannot act, and no code path here can start a review.
                  aria-disabled={entry.startable ? undefined : true}
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  aria-describedby={entry.unavailableReason !== null ? reasonId : undefined}
                  onClick={() => onEntryActivate(entry)}
                >
                  <span className="rhc-entry-name">{entry.name}</span>
                  {/* Maturity and availability are TEXT, never colour alone. */}
                  <span className="rhc-entry-maturity">{entry.maturityLabel}</span>
                </button>

                <p className="rhc-entry-facts">
                  {`${entry.adapterLabel} · ${entry.installLabel} · ${entry.startLabel}`}
                </p>
                <p className="rhc-entry-caps">{entry.capabilitySummary}</p>
                {entry.unavailableReason !== null && (
                  <p className="rhc-entry-reason" id={reasonId}>{entry.unavailableReason}</p>
                )}

                {expanded && (
                  <div className="rhc-entry-detail" id={detailId} role="group" aria-label={`${entry.name} detail`}>
                    <p className="rhc-entry-desc">{entry.description}</p>
                    <dl className="rhc-entry-meta">
                      <div className="rhc-identity-row">
                        <dt className="rhc-key">Environments</dt>
                        <dd className="rhc-value">{entry.environmentLabel}</dd>
                      </div>
                      <div className="rhc-identity-row">
                        <dt className="rhc-key">Model configuration</dt>
                        <dd className="rhc-value">{entry.modelConfigurationLabel}</dd>
                      </div>
                      <div className="rhc-identity-row">
                        <dt className="rhc-key">Read-only review</dt>
                        <dd className="rhc-value">{entry.readOnlyReviewLabel}</dd>
                      </div>
                    </dl>
                    {/* All fifteen, each with its state in words — a false
                        capability can never read as a supported one. */}
                    <ul className="rhc-caps">
                      {entry.capabilities.map((capability) => (
                        <li
                          className="rhc-cap"
                          key={capability.capability}
                          data-proven={capability.proven ? 'true' : 'false'}
                        >
                          <span className="rhc-key">{capability.label}</span>
                          <span className="rhc-value">{capability.statusLabel}</span>
                        </li>
                      ))}
                    </ul>
                    {entry.unavailableReasons.length > 0 && (
                      <ul className="rhc-reasons">
                        {entry.unavailableReasons.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                    <ul className="rhc-reasons">
                      {entry.verificationNotes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
