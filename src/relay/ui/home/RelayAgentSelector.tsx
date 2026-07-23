import type { AvailabilityStatus } from './contracts';

export function RelayAgentSelector({ label, value, options, statuses, onChange }: {
  label: string; value: string; options: string[]; statuses: Record<string, AvailabilityStatus>; onChange: (value: string) => void;
}) {
  return <fieldset className="rh-agent-select"><legend>{label}</legend>
    {options.map((option) => <label key={option}><input type="radio" name={label} value={option} checked={value === option}
      onChange={() => onChange(option)} /><span><b>{option}</b><small>{(statuses[option] ?? 'not-configured').replaceAll('-', ' ')}</small></span></label>)}
  </fieldset>;
}
