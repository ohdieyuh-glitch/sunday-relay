import './relay-stage-backdrop.css';
import { projectBackdropChoices, type RelayBackdropId } from '../../shared/relay-stage-backdrop';

/**
 * CHOOSING A SCENE.
 *
 * A radio group, because the choices are mutually exclusive and a user must be
 * able to see all of them at once — a dropdown would hide the fact that "None"
 * is one of them, and None is the one this build ships selected.
 *
 * IT SAYS WHAT EACH CHOICE IS, not how it feels. And where a scene animates, it
 * says so — and, when reduced motion is on, that the setting will still that
 * scene. A picker that offered "Space Station" without mentioning either would
 * be describing a different product to two different users.
 *
 * NOTHING HERE PERSISTS ANYTHING. The handler goes to whoever owns the
 * preference; this component reads a value and reports a choice, and cannot
 * decide on the user's behalf.
 */

export function RelayStageBackdropPicker({
  selected, reducedMotion = false, onSelect, name = 'relay-stage-backdrop',
}: {
  readonly selected: string | null | undefined;
  readonly reducedMotion?: boolean;
  /** Absent means the surface cannot change the setting, and draws no control. */
  readonly onSelect?: (id: RelayBackdropId) => void;
  readonly name?: string;
}) {
  const choices = projectBackdropChoices({ selected, reducedMotion });

  // A control that cannot act is not drawn — the same rule the run panel and
  // the MCP settings surface hold. A read-only host gets the list, not inputs
  // that silently do nothing.
  const interactive = onSelect !== undefined;

  return (
    <fieldset className="rsbp" data-backdrop-picker={interactive ? 'interactive' : 'readonly'}>
      <legend className="rsbp-legend">STAGE BACKDROP</legend>
      <p className="rsbp-note">
        Scenery only. A backdrop changes nothing Relay reports, gates nothing, and
        is never part of a mission record.
      </p>
      <ul className="rsbp-list">
        {choices.map((choice) => (
          <li key={choice.id} className={choice.selected ? 'rsbp-item is-selected' : 'rsbp-item'}>
            {interactive ? (
              <label className="rsbp-label">
                <input
                  type="radio"
                  name={name}
                  value={choice.id}
                  checked={choice.selected}
                  onChange={() => onSelect(choice.id)}
                />
                <span className="rsbp-name">{choice.label}</span>
              </label>
            ) : (
              // Read-only: a <label> wrapping no form control labels nothing,
              // and announces itself to assistive technology as if it did.
              <p className="rsbp-label">
                <span className="rsbp-name">{choice.label}</span>
                {choice.selected && <span className="rsbp-current">SELECTED</span>}
              </p>
            )}
            <p className="rsbp-description">{choice.description}</p>
            {choice.animated && (
              <p className="rsbp-motion">
                {choice.changesWithReducedMotion
                  // Said only when it is true of THIS user's setting.
                  ? 'This scene moves. Your reduced-motion setting stills it.'
                  : 'This scene moves.'}
              </p>
            )}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
