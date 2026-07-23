import type { RelayDogState } from './contracts';

export function RelayHomeDog({ state }: { state: RelayDogState }) {
  return <section className={`rh-dog rh-dog--${state}`} aria-label={`Relay Dog: READY, ${state}`}>
    <div className="rh-dog-grid" aria-hidden="true"><pre>{`  ▄▀▀▄
 █ ▀▄█__
  ▀▄  _  ▀▄
   /_/  /_/`}</pre></div>
    <div><p className="rh-kicker"><i /> RELAY DOG · READY</p>
      <strong>{state.toUpperCase()}</strong>
      <p>Tell me what you want to build, or choose a starting route below.</p>
      <small>Context relay idle · No mission running</small>
    </div>
  </section>;
}
