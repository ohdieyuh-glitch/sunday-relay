import type { RelayMissionEconomicsProjection } from '../../mission/economics';

/**
 * MISSION ECONOMICS — the compact website surface (Milestone 5).
 *
 * Presentation only. Every value arrives already decided by the SHARED
 * projection (`projectMissionEconomics`), which the CLI renders from too — so
 * the two surfaces cannot drift in what they claim. This component never
 * computes a total, never converts a currency, and never turns a missing
 * amount into $0.00: it prints the words the domain chose.
 *
 * The full Mission Operations interface is Milestone 6; this is a focused
 * summary in the existing workspace section language.
 */
export function RelayMissionEconomics({
  economics,
  onRequestBudgetChange,
  onViewReceipts,
}: {
  economics: RelayMissionEconomicsProjection;
  /** Routed through the validated change_budget command — never a direct edit. */
  onRequestBudgetChange?: () => void;
  onViewReceipts?: () => void;
}) {
  const state = economics.hardLimitReached
    ? 'hard-limit'
    : economics.approvalRequired
      ? 'approval'
      : economics.warning
        ? 'warning'
        : 'ok';

  return (
    <section
      className={`rpw-economics rpw-economics--${state}`}
      aria-label="Mission economics"
    >
      <h3 className="rpw-section-title">MISSION ECONOMICS</h3>

      <p className={`rpw-economics-status rpw-economics-status--${state}`} role="status">
        {economics.statusLabel}
      </p>

      <dl className="rpw-economics-grid">
        <EconomicsRow label="Budget" value={economics.budgetLabel} />
        <EconomicsRow label="Finalized actual" value={economics.finalizedActualLabel} />
        <EconomicsRow label="Provisional" value={economics.provisionalActualLabel} />
        <EconomicsRow label="Known pending" value={economics.pendingLabel} />
        <EconomicsRow label="Projected total" value={economics.projectedTotalLabel} />
        <EconomicsRow label="Remaining" value={economics.remainingLabel} />
        <EconomicsRow label="Cost records" value={economics.completenessLabel} />
        <EconomicsRow label="Verified mission cost" value={economics.verifiedMissionCostLabel} />
      </dl>

      <h4 className="rpw-economics-subtitle">COST BREAKDOWN</h4>
      <ul className="rpw-economics-categories">
        {economics.categories.map((category) => (
          <li key={category.category} className="rpw-economics-category">
            <span className="rpw-economics-category-label">{category.label}</span>
            <span className="rpw-economics-category-actual">{category.actualLabel}</span>
            <span className="rpw-dim rpw-economics-category-status">{category.statusLabel}</span>
          </li>
        ))}
      </ul>

      {economics.safeNotices.length > 0 && (
        <ul className="rpw-economics-notices">
          {economics.safeNotices.map((notice) => (
            <li key={notice} className="rpw-dim">
              {notice}
            </li>
          ))}
        </ul>
      )}

      {(onViewReceipts || onRequestBudgetChange) && (
        <div className="rpw-economics-actions">
          {onViewReceipts && (
            <button type="button" className="rpw-economics-action" onClick={onViewReceipts}>
              VIEW RECEIPTS
            </button>
          )}
          {onRequestBudgetChange && (
            <button type="button" className="rpw-economics-action" onClick={onRequestBudgetChange}>
              REQUEST BUDGET CHANGE
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function EconomicsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rpw-economics-row">
      <dt className="rpw-economics-term">{label}</dt>
      <dd className="rpw-economics-value">{value}</dd>
    </div>
  );
}
