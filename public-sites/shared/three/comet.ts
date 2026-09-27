import * as THREE from 'three';

/**
 * A SIGNAL: a directed tube with a bright travelling head and a decaying trail.
 *
 * Adapted from the landing's signal tracer (`landing/three/tracer.ts`), which
 * is bound to one fixed path around the retired mark. The mechanics are kept
 * exactly — the pulse is a shader uniform, never moved geometry; the trail
 * exists only BEHIND the head; additive, no depth write — and generalised to
 * any curve, any colour, open or closed.
 */

export type Comet = {
  readonly object: THREE.Mesh;
  /** Head position 0..1 along the curve. Values past 1 on an open path hide the pulse. */
  setHead(head: number): void;
  setPresence(presence: number): void;
  dispose(): void;
};

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uHead;
  uniform float uPresence;
  uniform float uClosed;
  uniform float uBase;
  uniform float uTrail;
  uniform vec3 uCore;
  uniform vec3 uGlow;
  varying vec2 vUv;

  void main() {
    float d = vUv.x - uHead;
    // Closed paths wrap so the trail survives the seam; open paths do not.
    d = mix(d, d - floor(d + 0.5), uClosed);
    float trail = d < 0.0 ? exp(d * uTrail) : 0.0;
    float head = exp(-abs(d) * 150.0);
    float intensity = uBase + trail * 0.85 + head * 2.4;
    vec3 color = mix(uGlow, uCore, clamp(head * 1.4, 0.0, 1.0));
    gl_FragColor = vec4(color * intensity, intensity * uPresence);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

export function createComet(
  curve: THREE.Curve<THREE.Vector3>,
  options: {
    readonly closed: boolean;
    readonly radius: number;
    readonly glow: number;
    readonly core: number;
    readonly tubular?: number;
    readonly radial?: number;
    /** Resting brightness of the whole path. 0 draws only the pulse. */
    readonly base?: number;
    /** Trail decay; larger is shorter. */
    readonly trail?: number;
  },
): Comet {
  const geometry = new THREE.TubeGeometry(
    curve,
    options.tubular ?? 160,
    options.radius,
    options.radial ?? 6,
    options.closed,
  );
  const uniforms = {
    uHead: { value: 0 },
    uPresence: { value: 1 },
    uClosed: { value: options.closed ? 1 : 0 },
    uBase: { value: options.base ?? 0.06 },
    uTrail: { value: options.trail ?? 22 },
    uCore: { value: new THREE.Color(options.core) },
    uGlow: { value: new THREE.Color(options.glow) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    object: mesh,
    setHead(head) {
      uniforms.uHead.value = head;
    },
    setPresence(presence) {
      uniforms.uPresence.value = presence;
      mesh.visible = presence > 0.002;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
