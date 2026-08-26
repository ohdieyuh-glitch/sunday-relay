import { LANDING_SCENES, SCENE_COUNT, smoothstep } from './choreography';
import { useLandingRuntime, usePrefersReducedMotion } from './useLandingRuntime';

/**
 * THE RELAY LANDING EXPERIENCE.
 *
 * Structure follows the two references' shared conclusion: the render is the
 * page, and the chrome is corner-anchored around it. One fixed canvas, one tall
 * scroll track that exists only to give the camera somewhere to travel, and a
 * chrome layer that never scrolls.
 *
 * ALL DOM MOTION IS OPACITY AND A FEW PIXELS OF TRANSLATE. Reference A does
 * exactly this — "opacity is the primary transition property" — and it is the
 * right division of labour: spatial motion belongs to WebGL, where it can be
 * depth-sorted and lit. Sliding DOM panels around on top of a 3D scene is how a
 * page ends up with two contradictory ideas of where things are.
 */
export function RelayLanding(): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const { canvasRef, scrollRef, position, telemetry, anchors } = useLandingRuntime(reducedMotion);
  const scene = LANDING_SCENES[position.index];

  // A beat's copy holds full opacity across its middle and fades only at the
  // handover, so a headline is never half-legible while the camera is between
  // marks. The FIRST beat does not fade in and the LAST does not fade out —
  // otherwise the page opens at 15% opacity, which reads as a broken render
  // rather than as a transition, and closes the same way on the CTA.
  // The crossfade is DELIBERATELY NARROW and its floor is high. The camera is
  // already moving continuously, so the copy does not need to disappear to
  // signal a change — and a wide fade means a headline spends most of a beat
  // partly transparent, which reads as a dimmed page rather than a transition.
  const fadeIn = position.index === 0 ? 1 : smoothstep(position.local / 0.07);
  const fadeOut =
    position.index === LANDING_SCENES.length - 1 ? 1 : smoothstep((1 - position.local) / 0.07);
  const copyOpacity = Math.max(0.45, fadeIn * fadeOut);

  return (
    <div
      className="rl3"
      data-scene={scene.id}
      data-reduced={reducedMotion ? 'true' : 'false'}
      data-static={telemetry.webgl ? 'false' : 'true'}
    >
      <canvas className="rl3-canvas" ref={canvasRef} aria-hidden="true" />

      {!telemetry.webgl && (
        // Not an error state — a legible one. The page keeps its structure and
        // its copy; it loses only the render.
        <div className="rl3-nogl" role="status">
          <span className="rl3-label">STATIC MODE · 3D UNAVAILABLE ON THIS DEVICE</span>
        </div>
      )}

      <header className="rl3-brand">
        <span className="rl3-mark" aria-hidden="true" />
        <span className="rl3-wordmark">SUNDAY RELAY</span>
        <span className="rl3-label rl3-brand-sub">AQUALA TECHNOLOGIES</span>
      </header>

      {/* Floating system chips, positioned by projecting world anchors. Depth
          drives both scale and opacity, so a chip behind the Dog reads as
          behind it rather than merely smaller. */}
      <div className="rl3-nodes" aria-hidden="true">
        {(scene.nodes ?? []).map((node, i) => {
          const anchor = anchors[i];
          if (!anchor || !anchor.visible) return null;
          const near = 1 - Math.min(1, Math.max(0, anchor.depth));
          return (
            <span
              key={node}
              className="rl3-node"
              style={{
                transform: `translate3d(${anchor.x}px, ${anchor.y}px, 0) scale(${0.82 + near * 0.3})`,
                // Floor raised: a chip is a LABEL, and depth should modulate
                // its presence, not decide whether it can be read at all.
                opacity: (0.62 + near * 0.38) * copyOpacity,
              }}
            >
              {node}
            </span>
          );
        })}
      </div>

      <div className="rl3-copy" style={{ opacity: copyOpacity }}>
        <p className="rl3-label rl3-eyebrow">{scene.eyebrow}</p>
        <h1 className="rl3-headline">{scene.headline}</h1>
        <p className="rl3-body">{scene.body}</p>
        {scene.cta && telemetry.webgl && (
          <a className="rl3-cta" href={scene.cta.href}>
            {scene.cta.label}
          </a>
        )}
      </div>

      {/* Reference B's telemetry register, reporting MEASURED values only. */}
      <div className="rl3-telemetry rl3-label">
        <span>{telemetry.width} × {telemetry.height}</span>
        <span>DPR {telemetry.dpr.toFixed(2)}</span>
        <span>{telemetry.tier.toUpperCase()}</span>
        <span>{telemetry.fps > 0 ? `${telemetry.fps} FPS` : 'MEASURING'}</span>
        {reducedMotion && <span>REDUCED MOTION</span>}
      </div>

      <nav className="rl3-index rl3-label" aria-label="Sections">
        {LANDING_SCENES.map((s) => (
          <span key={s.id} className="rl3-tick" data-active={s.index === position.index ? 'true' : 'false'}>
            {String(s.index + 1).padStart(2, '0')}
          </span>
        ))}
      </nav>

      {/* The scroll track. It carries no content — its only job is to give the
          camera a distance to travel. Each beat is one viewport tall. */}
      <div className="rl3-track" ref={scrollRef} style={{ height: `${SCENE_COUNT * 100}vh` }} aria-hidden="true" />

      {/* Every beat, in document order. This serves assistive technology AND
          it IS the page on any client that never runs the loop.

          THE LOOP IS WHAT ADVANCES THE BEATS. Without a WebGL context there is
          no loop, so the fixed chrome above is frozen on beat one forever — and
          a visitor on such a device could never reach the call to action at
          beat eight. So in static mode this region becomes the visible
          document, CTA included, and the frozen chrome steps aside. */}
      <div className="rl3-sr">
        {LANDING_SCENES.map((s) => (
          <section key={s.id} aria-label={s.eyebrow}>
            <p className="rl3-label">{s.eyebrow}</p>
            <h2>{s.headline}</h2>
            <p>{s.body}</p>
            {s.nodes && <ul>{s.nodes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {s.cta && (
              <a className="rl3-cta" href={s.cta.href}>
                {s.cta.label}
              </a>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
