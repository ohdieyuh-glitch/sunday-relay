import './site.css';
import { initChrome, prefersReducedMotion } from '../shared/chrome';
import { webglAvailable } from '../shared/three/stage';

initChrome();
initMissionSteps();

const host = document.getElementById('stage');
const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-scene]'));

if (host && sections.length > 0) {
  if (!webglAvailable()) {
    host.className = 'pw-stage-fallback';
  } else {
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const chips = Array.from(document.querySelectorAll<HTMLElement>('.wl-role-chip'));
    const telemetry = document.getElementById('telemetry');

    void import('./dog-stage').then(({ mountDogStage }) => {
      mountDogStage(host, canvas, sections, prefersReducedMotion(), {
        onRoleAnchors(anchors) {
          anchors.forEach((anchor, i) => {
            const chip = chips[i];
            if (!chip) return;
            // Labels belong to the Julius chapter alone; elsewhere the orbits may glow
            // faintly, but nothing should label them over other copy.
            // On a narrow screen the orbits are too small to label without
            // covering the Dog; the roles are listed in the copy right below.
            const roomy = window.innerWidth >= 700;
            const opacity = roomy && anchor.visible ? Math.max(0, (anchor.presence - 0.62) / 0.38) : 0;
            chip.style.opacity = opacity.toFixed(3);
            if (opacity > 0) {
              chip.style.transform = `translate3d(${anchor.x.toFixed(1)}px, ${anchor.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
            }
          });
        },
        // MEASURED values only — the landing's rule. Nothing here is estimated,
        // and FPS says MEASURING until a full second has actually been counted.
        onTelemetry({ width, height, dpr, fps, tier }) {
          if (!telemetry) return;
          const parts = [
            `${width} × ${height}`,
            `DPR ${dpr.toFixed(2)}`,
            tier.toUpperCase(),
            fps > 0 ? `${fps} FPS` : 'MEASURING',
          ];
          telemetry.replaceChildren(...parts.map((text) => {
            const span = document.createElement('span');
            span.textContent = text;
            return span;
          }));
        },
      });
    });
  }
}

/**
 * The mission loop marks the step the reader has reached. Without this script
 * every step is simply shown; with it, the loop advances as the section
 * scrolls, which is the only thing the animation is allowed to say.
 */
function initMissionSteps(): void {
  const list = document.getElementById('mission-steps');
  if (!list) return;
  const steps = Array.from(list.children) as HTMLElement[];
  let queued = false;
  const update = () => {
    queued = false;
    const rect = list.getBoundingClientRect();
    const viewport = window.innerHeight;
    // 0 when the list's top reaches 85% of the viewport, 1 when its bottom reaches 45%.
    const start = viewport * 0.85;
    const end = viewport * 0.45;
    const span = rect.height + (start - end);
    const progress = Math.min(1, Math.max(0, (start - rect.top) / span));
    const active = Math.min(steps.length - 1, Math.floor(progress * steps.length));
    steps.forEach((step, i) => {
      step.dataset.state = progress <= 0 ? 'next' : i < active ? 'done' : i === active ? 'active' : 'next';
    });
  };
  if (prefersReducedMotion()) {
    steps.forEach((step) => { step.dataset.state = 'done'; });
    return;
  }
  window.addEventListener('scroll', () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}
