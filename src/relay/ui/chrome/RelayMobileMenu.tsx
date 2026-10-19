import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode } from 'react';
import { RelayDogMark } from '../pixel-dog';

/**
 * Shared mobile chrome — founder mobile header structure: brand at left, one
 * gold MENU block at right, everything else behind an accessible full-screen
 * menu. Used by the Entry Home and Active Workspace headers (each keeps its
 * own items). Pure presentation + local dialog behavior:
 *   - focus moves to CLOSE on open and is RESTORED on close
 *   - Tab is trapped inside the dialog; Escape closes
 *   - body scroll locks while open and restores on close
 *   - touch-safe (≥44px) rows; safe-area insets; reduced-motion friendly
 * No routing, no store, no Relay Core contact — actions leave via callbacks.
 */

export interface MobileMenuItem {
  id: string;
  label: string;
  /** Secondary line, e.g. a truthful status. */
  hint?: string;
  /** Absent → a non-interactive status row. */
  onSelect?: () => void;
  disabled?: boolean;
}

export function RelayMenuButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="rmc-menu-btn"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label="Open menu"
    >
      MENU
    </button>
  );
}

export function RelayMobileMenu({
  open,
  title = 'SUNDAY RELAY',
  statusLine,
  items,
  onClose,
}: {
  open: boolean;
  title?: string;
  /** Small truthful route/status line under the brand. */
  statusLine?: ReactNode;
  items: MobileMenuItem[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [open]);

  // The overlay portals to <body>: headers live inside positioned stacking
  // contexts (z-indexed page bands) that would trap a fixed child beneath
  // later siblings. Only rendered client-side while open — never in SSR.
  if (!open || typeof document === 'undefined') return null;

  const trapKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !overlayRef.current) return;
    const focusables = Array.from(
      overlayRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="rmc-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      onKeyDown={trapKeys}
    >
      <header className="rmc-head">
        <span className="rmc-brand">
          <RelayDogMark unit={2} />
          <span className="rmc-title">{title}</span>
        </span>
        <button
          ref={closeRef}
          type="button"
          className="rmc-close"
          onClick={onClose}
          aria-label="Close menu"
        >
          ✕ CLOSE
        </button>
      </header>
      {statusLine && <p className="rmc-status">{statusLine}</p>}
      <nav className="rmc-nav" aria-label="Menu items">
        <ul className="rmc-list">
          {items.map((item) => (
            <li key={item.id}>
              {item.onSelect ? (
                <button
                  type="button"
                  className="rmc-item"
                  disabled={item.disabled}
                  onClick={() => {
                    item.onSelect?.();
                    onClose();
                  }}
                >
                  <span className="rmc-item-label">{item.label}</span>
                  {item.hint && <span className="rmc-item-hint">{item.hint}</span>}
                </button>
              ) : (
                <span className="rmc-item rmc-item--static">
                  <span className="rmc-item-label">{item.label}</span>
                  {item.hint && <span className="rmc-item-hint">{item.hint}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>,
    document.body,
  );
}
