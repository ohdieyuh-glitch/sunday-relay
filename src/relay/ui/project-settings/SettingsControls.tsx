import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Choice } from './options';

/**
 * Shared click-first controls for Project Settings — native semantic inputs
 * (radio, checkbox) styled as plates, segments, chips, switches, and
 * steppers. No custom div-based controls; keyboard and screen-reader
 * behavior comes from the platform.
 */

export function SettingsField({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="rps-field">
      <legend className="rps-legend">{legend}</legend>
      {hint && <p className="rps-hint">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** Single-choice option plates (radio group). */
export function RadioPlates<T extends string>({
  name,
  choices,
  value,
  onChange,
  compact = false,
}: {
  name: string;
  choices: Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  compact?: boolean;
}) {
  return (
    <div className={`rps-plates${compact ? ' rps-plates--compact' : ''}`} role="presentation">
      {choices.map((c) => (
        <label key={c.value} className={`rps-plate${value === c.value ? ' is-selected' : ''}${c.unavailable ? ' is-unavailable' : ''}`}>
          <input
            type="radio"
            name={name}
            value={c.value}
            checked={value === c.value}
            disabled={c.unavailable}
            onChange={() => onChange(c.value)}
          />
          <span className="rps-plate-label">{c.label}</span>
          {c.recommended && <span className="rps-rec">RELAY RECOMMENDS</span>}
          {c.hint && <span className="rps-plate-hint">{c.hint}</span>}
        </label>
      ))}
    </div>
  );
}

/** Compact segmented control (radio group in a row). */
export function Segmented<T extends string>({
  name,
  choices,
  value,
  onChange,
}: {
  name: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="rps-segmented" role="presentation">
      {choices.map((c) => (
        <label key={c.value} className={`rps-segment${value === c.value ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value={c.value}
            checked={value === c.value}
            onChange={() => onChange(c.value)}
          />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Multi-select chips (checkbox group). */
export function Chips({
  choices,
  values,
  onToggle,
  statuses,
}: {
  choices: Choice[];
  values: string[];
  onToggle: (value: string) => void;
  /** Optional truthful status label per choice value (e.g. COMING LATER). */
  statuses?: Record<string, string>;
}) {
  return (
    <div className="rps-chips" role="presentation">
      {choices.map((c) => (
        <label key={c.value} className={`rps-chip${values.includes(c.value) ? ' is-selected' : ''}${c.unavailable ? ' is-unavailable' : ''}`}>
          <input
            type="checkbox"
            value={c.value}
            checked={values.includes(c.value)}
            disabled={c.unavailable}
            onChange={() => onToggle(c.value)}
          />
          <span>{c.label}</span>
          {c.recommended && <span className="rps-rec rps-rec--chip">REC</span>}
          {statuses?.[c.value] && <span className="rps-chip-status">{statuses[c.value]}</span>}
        </label>
      ))}
    </div>
  );
}

/** Toggle switch row (checkbox with switch styling). */
export function ToggleRow({
  label,
  checked,
  onChange,
  status,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  status?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`rps-toggle${disabled ? ' is-unavailable' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="rps-toggle-track" aria-hidden="true">
        <span className="rps-toggle-knob" />
      </span>
      <span className="rps-toggle-label">{label}</span>
      {status && <span className="rps-chip-status">{status}</span>}
    </label>
  );
}

/** Preset row + stepper: preset buttons with a bounded custom stepper. */
export function PresetStepper({
  label,
  presets,
  value,
  onChange,
  format = (v: number) => String(v),
  step = 1,
  min = 0,
  max = 990,
}: {
  label: string;
  presets: number[];
  value: number;
  onChange: (value: number) => void;
  format?: (v: number) => string;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [custom, setCustom] = useState(false);
  const isPreset = presets.includes(value);
  return (
    <div className="rps-preset-row" role="group" aria-label={label}>
      <span className="rps-preset-label">{label}</span>
      <div className="rps-preset-btns">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={`rps-preset${value === p && !custom ? ' is-selected' : ''}`}
            aria-pressed={value === p && !custom}
            onClick={() => {
              setCustom(false);
              onChange(p);
            }}
          >
            {format(p)}
          </button>
        ))}
        <button
          type="button"
          className={`rps-preset${custom || !isPreset ? ' is-selected' : ''}`}
          aria-pressed={custom || !isPreset}
          onClick={() => setCustom(true)}
        >
          CUSTOM
        </button>
      </div>
      {(custom || !isPreset) && (
        <div className="rps-stepper" role="group" aria-label={`${label} custom value`}>
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            disabled={value - step < min}
            onClick={() => onChange(Math.max(min, value - step))}
          >
            −
          </button>
          <span className="rps-stepper-value" aria-live="polite">
            {format(value)}
          </span>
          <button
            type="button"
            aria-label={`Increase ${label}`}
            disabled={value + step > max}
            onClick={() => onChange(Math.min(max, value + step))}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
