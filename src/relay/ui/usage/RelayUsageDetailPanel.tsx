import { useEffect, useRef } from 'react';
import type { RelayUsageDetailView } from '../../usage';
import './relay-usage.css';

/**
 * THE USAGE DETAIL PANEL — the one detailed usage surface, opened by the
 * Usage Bar or a notification's VIEW USAGE action. A right-docked drawer in
 * the Live Terminal's established pattern: `role="dialog"`, Escape closes,
 * focus moves to the close control on open and returns to the opener on
 * close, body scroll locks while open.
 *
 * Every figure comes from the shared projection. Meters always carry text —
 * color is never the only signal — and the provenance banner renders before
 * any figure, so simulated or offline data can never read as live.
 */
export function RelayUsageDetailPanel({
  open,
  view,
  onClose,
  returnFocusTo,
}: {
  open: boolean;
  view: RelayUsageDetailView;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus?.();
    };
  }, [open, returnFocusTo]);

  if (!open) return null;

  return (
    <div className="rus-overlay" data-relay-usage-panel="true">
      <section
        className="rus-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Usage details"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="rus-panel-head">
          <h2 className="rus-panel-title">USAGE</h2>
          <button
            type="button"
            ref={closeRef}
            className="rus-panel-close"
            onClick={onClose}
            aria-label="Close usage details"
          >
            CLOSE
          </button>
        </header>

        {view.provenanceLabel !== null && (
          <p className="rus-provenance" role="note">
            {view.provenanceLabel}
          </p>
        )}

        {view.sections.map((section) => (
          <section
            key={section.key}
            className="rus-section"
            aria-label={section.title}
          >
            <h3 className="rus-section-title">{section.title}</h3>
            {section.meter !== null && (
              <div className="rus-meter">
                <div className="rus-meter-track" aria-hidden="true">
                  <div
                    className="rus-meter-fill"
                    style={{ width: `${section.meter.percent}%` }}
                  />
                </div>
                <span className="rus-meter-text">{section.meter.text}</span>
              </div>
            )}
            <dl className="rus-rows">
              {section.rows.map((row) => (
                <div className="rus-row" key={`${section.key}-${row.label}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            {section.note !== null && <p className="rus-note">{section.note}</p>}
          </section>
        ))}
      </section>
    </div>
  );
}
