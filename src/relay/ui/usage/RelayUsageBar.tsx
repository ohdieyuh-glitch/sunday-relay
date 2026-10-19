import type { RelayUsageBarView } from '../../usage';
import './relay-usage.css';

/**
 * THE USAGE BAR — one compact, truthful line in the top-right area of the
 * header, and (as `compact`) a small echo pinned inside focused fullscreen
 * panels. A REAL button: its accessible name carries the current summary,
 * and selecting it opens the canonical usage detail panel.
 *
 * The bar renders whatever `projectUsageBar` derived — it never computes
 * usage, never compares thresholds, and never invents a number.
 */
export function RelayUsageBar({
  view,
  onOpen,
  compact = false,
}: {
  view: RelayUsageBarView;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rus-bar rus-bar--${view.tone}${compact ? ' rus-bar--compact' : ''}`}
      aria-label={view.ariaLabel}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      {view.summary}
    </button>
  );
}
