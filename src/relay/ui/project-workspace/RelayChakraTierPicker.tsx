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
 * IT SAYS WHAT IT IS. This control chooses an APPEARANCE, stored beside the
 * colorway and the stage backdrop, and the note below says so in those words
 * rather than letting a seven-step ladder imply a progression that has not
 * been earned. The Coliseum progression projection now also EARNS tiers
 * (`mission/coliseum/agent-progression.ts`): a host holding one passes it as
 * `earnedTier`, the earned tier overrides the choice on the Dog
 * (`preferredChakraTier`), and the note states the override truthfully.
 * Without an earned tier — the default — everything reads exactly as before.
 *
 * It reuses the backdrop picker's presentation deliberately: it is the same
 * kind of control — an appearance setting that changes nothing Relay reports
 * — and giving it its own look would suggest otherwise.
 */

export function RelayChakraTierPicker({
  selected,
  onSelect,
  earnedTier = null,
  name = 'relay-chakra-tier',
}: {
  readonly selected: ChakraTier | null | undefined;
  /** Absent means the surface cannot change the setting, and draws no inputs. */
  readonly onSelect?: (tier: ChakraTier | null) => void;
  /**
   * A tier EARNED through the Coliseum progression projection, when the host
   * has one. It never comes from this control: when present it overrides the
   * chosen appearance on the Dog, and the note below says so truthfully.
   * `null` — the default — means nothing has been earned and the chosen
   * appearance stands, exactly as before.
   */
  readonly earnedTier?: ChakraTier | null;
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
    <fieldset
      className="rsbp rctp"
      data-tier-picker={interactive ? 'interactive' : 'readonly'}
      data-earned-tier={earnedTier ?? 'none'}
    >
      <legend className="rsbp-legend">RELAY DOG TIER</legend>
      {earnedTier === null ? (
        <p className="rsbp-note">
          Appearance only. Relay awards no levels — this is chosen, not earned, and it
          changes nothing Relay reports.
        </p>
      ) : (
        <p className="rsbp-note" data-testid="rctp-earned-note">
          {CHAKRA_ACCENTS[earnedTier].label} was earned in the Coliseum — it overrides the
          chosen appearance. The choice below is appearance only and applies when nothing
          is earned.
        </p>
      )}
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
