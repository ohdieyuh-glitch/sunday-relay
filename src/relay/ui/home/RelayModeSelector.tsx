import type { RelayHomeMode } from './contracts';

const descriptions: Record<RelayHomeMode, string> = {
  guided: 'Asks before meaningful or high-impact decisions.',
  semi: 'Handles more routine work and stops before high-impact actions.',
  autonomous: 'Continues only within explicitly approved tools, access, spending, time, and safety limits.',
};

export function RelayModeSelector({ value, onChange }: { value: RelayHomeMode | ''; onChange: (mode: RelayHomeMode) => void }) {
  return <div className="rh-mode" role="radiogroup" aria-label="Relay mode">
    {(['guided', 'semi', 'autonomous'] as const).map((mode) => <button key={mode} type="button" role="radio"
      aria-checked={value === mode} title={descriptions[mode]} onClick={() => onChange(mode)}
      className={value === mode ? 'is-selected' : ''}>{mode}</button>)}
    <span className="rh-sr-only" aria-live="polite">{value ? descriptions[value] : 'No Relay mode selected'}</span>
  </div>;
}
