import * as THREE from 'three';
import { LANDING_COLORS } from './materials';

/**
 * THE AQUALA SIGNAL TRACER.
 *
 * Reference A's hero emits a particle field — "specks burst downward from the
 * portal like a constellation collapsing into a fountain". That mechanic is
 * adapted, not copied: a burst is decorative, and the founder's brief is
 * explicit that this must read as INTELLIGENCE MOVING THROUGH A SYSTEM and not
 * as decorative spaghetti.
 *
 * So the signal is a single directed spline that passes BEHIND the Aquala mark,
 * crosses in front of it, and returns — with a bright travelling head and a
 * decaying trail. The depth crossing is the whole point: it is what proves the
 * mark is a solid object occupying space rather than a sprite, and it is only
 * legible because the pulse disappears behind the ring and re-emerges.
 *
 * The pulse is a SHADER uniform, not moved geometry. Rebuilding a tube's
 * vertices every frame to animate a highlight is the expensive way to do this
 * and it is what makes such effects stutter under scroll.
 */

export type SignalTracer = {
  readonly object: THREE.Object3D;
  /** Advance the travelling head. `flow` scales speed with scroll velocity. */
  update(time: number, flow: number, presence: number): void;
  dispose(): void;
};

/**
 * Control points for the signal path, in Aquala-mark radii. The path is closed
 * and deliberately asymmetric — a symmetric loop reads as an orbit, and an
 * orbit reads as a logo turntable.
 */
const PATH_POINTS: readonly THREE.Vector3[] = [
  new THREE.Vector3(-3.4, -0.9, -2.2),
  new THREE.Vector3(-1.7, 0.55, -1.15),
  new THREE.Vector3(-0.2, 1.35, 0.6),
  new THREE.Vector3(1.5, 0.7, 1.5),
  new THREE.Vector3(2.6, -0.5, 0.35),
  new THREE.Vector3(1.9, -1.3, -1.6),
  new THREE.Vector3(0.1, -1.5, -2.4),
  new THREE.Vector3(-1.9, -1.45, -2.6),
];

const VERTEX = /* glsl */ `
  varying vec2 vSignalUv;
  void main() {
    vSignalUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * `uHead` is the pulse position along the tube, 0..1. Distance is measured on a
 * WRAPPED axis so the trail survives the seam — without the wrap the pulse dies
 * every time it laps, which reads as a stutter exactly once per cycle.
 */
const FRAGMENT = /* glsl */ `
  uniform float uHead;
  uniform float uPresence;
  uniform vec3 uCore;
  uniform vec3 uGlow;
  varying vec2 vSignalUv;

  void main() {
    float d = vSignalUv.x - uHead;
    d = d - floor(d + 0.5);            // wrap to -0.5..0.5
    // TRAIL ONLY BEHIND THE HEAD. Writing this as exp(-clamp(-d,0,1) * k) looks
    // like it does that and does the opposite: everywhere AHEAD of the head the
    // clamp yields 0 and exp(0) is 1, so the whole tube burns at full trail
    // brightness and the signal reads as a painted noodle rather than a comet.
    float trail = d < 0.0 ? exp(d * 22.0) : 0.0;
    float head = exp(-abs(d) * 150.0);
    float base = 0.075;
    float intensity = base + trail * 0.85 + head * 2.4;
    vec3 color = mix(uGlow, uCore, clamp(head * 1.4, 0.0, 1.0));
    gl_FragColor = vec4(color * intensity, intensity * uPresence);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

export function createSignalTracer(radialSegments: number, tubularSegments: number): SignalTracer {
  const curve = new THREE.CatmullRomCurve3([...PATH_POINTS], true, 'catmullrom', 0.5);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, 0.028, radialSegments, true);
  const uniforms = {
    uHead: { value: 0 },
    uPresence: { value: 0 },
    uCore: { value: new THREE.Color(LANDING_COLORS.aqualaCore) },
    uGlow: { value: new THREE.Color(LANDING_COLORS.aqualaLight) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // Additive so the signal reads as light rather than as a painted wire, and
    // depthWrite off so it never carves a hole in the glass mark behind it.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  let head = 0;
  return {
    object: mesh,
    update(_time, flow, presence) {
      // Speed is scroll-reactive but floored, so the signal never freezes when
      // the page is still — a stopped signal reads as a broken page.
      head = (head + (0.0016 + flow * 0.02)) % 1;
      uniforms.uHead.value = head;
      uniforms.uPresence.value = presence;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
