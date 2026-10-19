import {
  CHAKRA_ACCENTS,
  CHAKRA_TIERS,
  type ChakraTier,
} from '../../shared/relay-chakra';

/**
 * CHOOSING THE RELAY DOG'S PROGRESSION TIER.
 *
 * Seven tiers, root through crown, applied as controlled accents to the Dog
 * and the Project Brain above it — they share one accent, which is what makes
 * the pair read as one system.
 *
 * IT SAYS WHAT IT IS. Relay awards no levels: nothing in this product counts
 * missions toward a rank or advances an agent. So this is an appearance
 * choice, stored beside the colorway and the stage backdrop, and the note
 * below says so in those words rather than letting a seven-step ladder imply
 * a progression that has not been earned. When Relay does award levels, the
 * tier arrives from there and this control becomes a display of it.
 *
 * It reuses the backdrop picker's presentation deliberately: it is the same
 * kind of control — an appearance setting that changes nothing Relay reports
 * — and giving it its own look would suggest otherwise.
 */

export function RelayChakraTierPicker({
  selected,
  onSelect,
  name = 'relay-chakra-tier',
}: {
  readonly selected: ChakraTier | null | undefined;
  /** Absent means the surface cannot change the setting, and draws no inputs. */
  readonly onSelect?: (tier: ChakraTier | null) => void;
  readonly name?: string;
}) {
  const interactive = onSelect !== undefined;
  // NO TIER is a real choice and comes first, because it is what a Relay that
  // has awarded nothing looks like — the Dog exactly as shipped.
  const choices: { id: ChakraTier | null; label: string; swatch: string | null }[] = [
    { id: null, label: 'NO TIER', swatch: null },
    ...CHAKRA_TIERS.map((tier) => ({
      id: tier as ChakraTier | null,
      label: CHAKRA_ACCENTS[tier].label,
      swatch: CHAKRA_ACCENTS[tier].accent,
    })),
  ];

  return (
    <fieldset className="rsbp rctp" data-tier-picker={interactive ? 'interactive' : 'readonly'}>
      <legend className="rsbp-legend">RELAY DOG TIER</legend>
      <p className="rsbp-note">
        Appearance only. Relay awards no levels — this is chosen, not earned, and it
        changes nothing Relay reports.
      </p>
      <ul className="rsbp-list rctp-list">
        {choices.map((choice) => {
          const isSelected = (selected ?? null) === choice.id;
          const key = choice.id ?? 'none';
          return (
            <li key={key} className={isSelected ? 'rsbp-item is-selected' : 'rsbp-item'}>
              {interactive ? (
                <label className="rsbp-label">
                  <input
                    type="radio"
                    name={name}
                    value={key}
                    checked={isSelected}
                    onChange={() => onSelect(choice.id)}
                  />
                  <span className="rsbp-name">
                    {choice.swatch !== null && (
                      <span
                        className="rctp-swatch"
                        aria-hidden="true"
                        style={{ background: choice.swatch }}
                      />
                    )}
                    {choice.label}
                  </span>
                </label>
              ) : (
                <p className="rsbp-label">
                  <span className="rsbp-name">{choice.label}</span>
                  {isSelected && <span className="rsbp-current">SELECTED</span>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
