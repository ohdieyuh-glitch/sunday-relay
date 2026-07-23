import type { ReactNode } from 'react';

export function RelaySettingsSection({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section className="rh-settings-section" aria-labelledby={`settings-${number}`}>
    <header><span>{number}</span><h3 id={`settings-${number}`}>{title}</h3></header><div className="rh-settings-fields">{children}</div>
  </section>;
}

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'rh-field rh-field--wide' : 'rh-field'}><span>{label}</span>{children}</label>;
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="rh-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" /><b>{label}</b></label>;
}
