import * as THREE from 'three';
import { buildDogMesh } from '../../src/relay/ui/landing/three/dog-mesh';
import { DogAnimator, springStep, type DogState } from '../../src/relay/ui/landing/three/dog-rig';
import { createLandingMaterials } from '../../src/relay/ui/landing/three/materials';
import { createComet, type Comet } from '../shared/three/comet';
import { createFrameLoop } from '../shared/three/loop';
import { createScrollRig, poseTracks, samplePose, sampleBySection, type Pose } from '../shared/three/scroll-rig';
import { addStageLights, createStage } from '../shared/three/stage';

/**
 * THE WONDERLAND STAGE — the Relay Dog, standing in the world.
 *
 * The same canonical Dog the landing renders (geometry, materials, rig), now
 * on Wonderland's own ground: the arcane circle from the art direction beneath
 * it, fragments of the world drifting in the fog around it, and — in the Julius
 * chapter — three signals orbiting it, one per persistent role.
 *
 * Colour ownership: violet is Wonderland's light and lives only in the render;
 * gold is the Dog's eyes; everything solid is the landing's ivory.
 */

const VIOLET = 0xa98bff;
const VIOLET_CORE = 0xf1eaff;
const DEG = Math.PI / 180;

/** Chapters: hero, world, persistent, julius, mission, card, identity, enter. */
export const CHAPTERS = ['top', 'world', 'persistent', 'julius', 'mission', 'card', 'identity', 'enter'] as const;

type Shot = {
  readonly focus: readonly [number, number, number];
  readonly azimuth: number;
  readonly elevation: number;
  readonly distance: number;
  readonly fov: number;
  readonly shiftX: number;
  readonly shiftY: number;
  readonly stage: number;
};

const LANDSCAPE: readonly Shot[] = [
  { focus: [0, 11, 0], azimuth: 10, elevation: 7, distance: 74, fov: 32, shiftX: 12.5, shiftY: 6.5, stage: 1 },
  { focus: [0, 8, 0], azimuth: -30, elevation: 17, distance: 96, fov: 32, shiftX: 24, shiftY: -3, stage: 0.85 },
  { focus: [0, 12, 0], azimuth: 32, elevation: 3, distance: 72, fov: 32, shiftX: 17, shiftY: 0, stage: 0.8 },
  { focus: [0, 13, 0], azimuth: -4, elevation: 11, distance: 80, fov: 32, shiftX: 16, shiftY: 1, stage: 1 },
  { focus: [0, 9, 0], azimuth: 58, elevation: 34, distance: 150, fov: 32, shiftX: 0, shiftY: -44, stage: 0.24 },
  { focus: [0, 11, 0], azimuth: -22, elevation: 12, distance: 66, fov: 32, shiftX: 17, shiftY: 0, stage: 0.85 },
  { focus: [0, 16.5, 0], azimuth: 18, elevation: 5, distance: 36, fov: 30, shiftX: 7.5, shiftY: 0, stage: 1 },
  { focus: [0, 10, 0], azimuth: 0, elevation: 12, distance: 112, fov: 32, shiftX: 0, shiftY: -28, stage: 1 },
];

const PORTRAIT_LIFT = [0.5, 0.4, 0.44, 0.44, 0.3, 0.44, 0.42, 0.4];
const PORTRAIT_STAGE = [1, 0.7, 0.6, 0.85, 0.3, 0.6, 0.9, 0.85];

/** How present the arcane circle and Julius's orbits are, per chapter. */
const RING_PRESENCE = [1, 1, 0.55, 0.35, 0.7, 0.45, 0.8, 1];
const ORBIT_PRESENCE = [0.18, 0, 0, 1, 0.3, 0.12, 0, 0.3];

/** What the Dog does in each chapter. It inhabits the page; it does not tour it. */
const DOG_INTENT: ReadonlyArray<{ state: DogState; x: number; yaw: number }> = [
  { state: 'LOOK', x: 0, yaw: 0.14 },
  { state: 'TURN', x: 0, yaw: -0.55 },
  { state: 'PAUSE', x: 0, yaw: 0.3 },
  { state: 'LOOK', x: 0, yaw: 0 },
  { state: 'IDLE', x: 3, yaw: 0.35 },
  { state: 'TURN', x: 0, yaw: -0.4 },
  { state: 'LOOK', x: 0, yaw: 0.05 },
  { state: 'IDLE', x: 0, yaw: 0 },
];

function shotToPose(shot: Shot): Pose {
  const az = shot.azimuth * DEG;
  const el = shot.elevation * DEG;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const focus = new THREE.Vector3(...shot.focus);
  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const offset = right.multiplyScalar(-shot.shiftX).add(up.multiplyScalar(-shot.shiftY));
  const position = focus.clone().addScaledVector(dir, shot.distance).add(offset);
  const target = focus.clone().add(offset);
  return { position: [position.x, position.y, position.z], target: [target.x, target.y, target.z], fov: shot.fov, stage: shot.stage };
}

/**
 * Landscape shots are authored at 16:10. A wider screen shows more world to
 * either side, so the same shift in world units would slide the subject back
 * toward the copy; the shift is scaled with the aspect so the subject keeps its
 * place in the FRAME rather than in the world.
 */
const AUTHORED_ASPECT = 1.6;
let landscapeCache: { aspect: number; tracks: ReturnType<typeof poseTracks> } | null = null;
function landscapeTracks(aspect: number): ReturnType<typeof poseTracks> {
  const key = Math.round(Math.min(2.4, Math.max(1, aspect)) * 100) / 100;
  if (landscapeCache?.aspect !== key) {
    landscapeCache = {
      aspect: key,
      tracks: poseTracks(LANDSCAPE.map((shot) => shotToPose({ ...shot, shiftX: (shot.shiftX * key) / AUTHORED_ASPECT }))),
    };
  }
  return landscapeCache.tracks;
}
let portraitCache: { aspect: number; tracks: ReturnType<typeof poseTracks> } | null = null;
function portraitTracks(aspect: number): ReturnType<typeof poseTracks> {
  const key = Math.round(aspect * 100) / 100;
  if (portraitCache?.aspect !== key) {
    const tablet = Math.min(1, Math.max(0, (key - 0.5) / 0.3));
    const shots = LANDSCAPE.map((shot, i) => {
      // The hero is closer on a phone: the Dog is the first thing on screen.
      // The identity close-up is further: a portrait frame cannot hold a
      // desktop's head-and-shoulders shot without cropping the Dog in half.
      const distance = shot.distance * (i === 0 ? 0.86 : i === 6 ? 1.9 : 1.06) * (1 + 0.2 * tablet);
      const vfov = 2 * Math.atan(Math.tan((shot.fov * DEG) / 2) / Math.min(1, key));
      const lift = PORTRAIT_LIFT[i] * (1 - 0.2 * tablet);
      return { ...shot, distance, shiftX: 0, shiftY: lift * distance * Math.tan(vfov / 2), stage: PORTRAIT_STAGE[i] };
    });
    portraitCache = { aspect: key, tracks: poseTracks(shots.map(shotToPose)) };
  }
  return portraitCache.tracks;
}

/** An ellipse in a tilted plane — one Julius role's orbit. */
class Orbit extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly rx: number,
    private readonly rz: number,
    private readonly tilt: THREE.Euler,
    private readonly centre: THREE.Vector3,
  ) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2;
    return target.set(Math.cos(a) * this.rx, 0, Math.sin(a) * this.rz).applyEuler(this.tilt).add(this.centre);
  }
}

export type RoleAnchor = { x: number; y: number; visible: boolean; presence: number };

export function mountDogStage(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  sections: readonly HTMLElement[],
  reducedMotion: boolean,
  hooks: {
    readonly onRoleAnchors?: (anchors: readonly RoleAnchor[]) => void;
    readonly onTelemetry?: (telemetry: { width: number; height: number; dpr: number; fps: number; tier: string }) => void;
  },
): { dispose(): void } {
  const stage = createStage(canvas, { fogNear: 70, fogFar: 240 });
  const { scene, camera, tier } = stage;
  addStageLights(scene, VIOLET, 0.45);
  const materials = createLandingMaterials(tier);

  // ---- the Dog ----------------------------------------------------------
  const dog = buildDogMesh(materials);
  scene.add(dog.root);
  const animator = new DogAnimator();

  // ---- ground: contact shadow (darkens) + the arcane circle (adds light) --
  const groundGeometry = new THREE.PlaneGeometry(420, 420, 1, 1);
  const shadowUniforms = { uDog: { value: new THREE.Vector2() } };
  const shadowMaterial = new THREE.ShaderMaterial({
    uniforms: shadowUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec2 uDog;
      varying vec3 vWorld;
      void main() {
        float contact = 1.0 - smoothstep(0.0, 8.5, length(vWorld.xz - uDog));
        gl_FragColor = vec4(0.0, 0.0, 0.0, contact * contact * 0.62);
      }
    `,
  });
  const shadow = new THREE.Mesh(groundGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  scene.add(shadow);

  const circleUniforms = {
    uTime: { value: 0 },
    uRing: { value: 1 },
    uViolet: { value: new THREE.Color(VIOLET) },
  };
  const circleMaterial = new THREE.ShaderMaterial({
    uniforms: circleUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uRing;
      uniform vec3 uViolet;
      varying vec3 vWorld;
      const float TAU = 6.2831853;

      float ring(float r, float radius, float width) {
        float w = max(width, fwidth(r) * 1.2);
        return 1.0 - smoothstep(0.0, w, abs(r - radius));
      }
      float hash(float n) { return fract(sin(n) * 43758.5453); }

      void main() {
        vec2 p = vWorld.xz;
        float r = length(p);
        float a = atan(p.y, p.x) / TAU + 0.5;

        // The grid: the world's floor, fading well before the fog does.
        vec2 cell = p / 6.0;
        vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
        float grid = (1.0 - min(min(g.x, g.y), 1.0)) * (1.0 - smoothstep(26.0, 150.0, r)) * 0.055;

        // THE ARCANE CIRCLE. Concentric rings, a band of rune segments turning
        // one way, a fine tick ring turning the other. It does NOT encode any
        // state — per the art direction it is the Dog's ground, not a readout.
        float spinA = uTime * 0.018;
        float spinB = -uTime * 0.011;
        float rings = ring(r, 9.6, 0.05) * 0.8 + ring(r, 13.6, 0.08) + ring(r, 14.35, 0.04) * 0.55 + ring(r, 18.2, 0.03) * 0.3;
        float band = smoothstep(10.5, 10.7, r) * (1.0 - smoothstep(12.5, 12.7, r));
        float segIndex = floor((a + spinA) * 40.0);
        float segLocal = fract((a + spinA) * 40.0);
        float rune = step(0.18, segLocal) * step(segLocal, 0.82) * step(0.35, hash(segIndex * 13.1));
        float runeRadial = step(0.5, fract((r - 10.7) * (0.8 + hash(segIndex) * 1.6)));
        float runes = band * rune * mix(0.35, 0.8, runeRadial);
        float tickBand = smoothstep(13.75, 13.8, r) * (1.0 - smoothstep(14.15, 14.2, r));
        float ticks = tickBand * step(fract((a + spinB) * 144.0), 0.16);
        float halo = exp(-pow((r - 12.0) / 4.2, 2.0)) * 0.1;

        float circle = (rings + runes * 0.55 + ticks * 0.7 + halo) * uRing;
        vec3 color = uViolet * circle + vec3(0.62, 0.58, 0.8) * grid;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const circle = new THREE.Mesh(groundGeometry, circleMaterial);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.03;
  scene.add(circle);

  // ---- glyphs rising from the circle -------------------------------------
  const glyphs = buildGlyphs(tier === 'low' ? 36 : 64);
  scene.add(glyphs.object);

  // ---- fragments of the world, drifting in the fog -----------------------
  const fragments = buildFragments(materials.ivory, tier === 'low' ? 12 : 20);
  scene.add(fragments.object);

  // ---- Julius: three orbits, one per persistent role ---------------------
  const centre = new THREE.Vector3(0, 12.5, 0);
  const orbitDefs = [
    { curve: new Orbit(15.5, 11.5, new THREE.Euler(0.32, 0.2, 0.18), centre), speed: 0.055, offset: 0.0 },
    { curve: new Orbit(14.0, 12.5, new THREE.Euler(-0.28, 1.2, -0.34), centre), speed: 0.046, offset: 0.33 },
    { curve: new Orbit(16.5, 13.0, new THREE.Euler(0.1, -0.9, 0.52), centre), speed: 0.038, offset: 0.66 },
  ];
  const orbits: Comet[] = orbitDefs.map(({ curve }, i) => {
    const comet = createComet(curve, {
      closed: true,
      radius: 0.075,
      glow: [VIOLET, 0xe9dcc0, 0xc9b8ff][i],
      core: [VIOLET_CORE, 0xfff6e2, VIOLET_CORE][i],
      base: 0.14,
      trail: 9,
      tubular: tier === 'low' ? 160 : 320,
      radial: tier === 'low' ? 4 : 8,
    });
    scene.add(comet.object);
    return comet;
  });
  /**
   * Where each role's label hangs: the point of its own orbit furthest out to
   * one side, so no label ever sits across the Dog's face. Architect upper
   * left, Coding Agent right, Reviewer lower left.
   */
  const LABEL_BIAS: ReadonlyArray<readonly [number, number]> = [[-1, 1.4], [1, 0.2], [-1, -1.4]];
  const roleLabelPoints = orbitDefs.map(({ curve }, i) => {
    let best = curve.getPoint(0);
    let bestScore = -Infinity;
    for (let s = 0; s < 96; s += 1) {
      const point = curve.getPoint(s / 96);
      const score = LABEL_BIAS[i][0] * point.x + LABEL_BIAS[i][1] * (point.y - centre.y);
      if (score > bestScore) { bestScore = score; best = point; }
    }
    return best;
  });

  // ---- input + layout -----------------------------------------------------
  const rig = createScrollRig(sections);
  const pointer = { x: 0, y: 0, active: false };
  const parallax = { x: 0, y: 0, vx: 0, vy: 0 };
  const loop = createFrameLoop(frame, !reducedMotion);

  const onPointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    pointer.active = true;
    loop.invalidate();
  };
  const onScroll = () => loop.invalidate();
  const onResize = () => { stage.resize(); rig.measure(); loop.invalidate(); };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  const layoutObserver = new ResizeObserver(() => { rig.measure(); loop.invalidate(); });
  layoutObserver.observe(document.body);

  const cam = { p: new THREE.Vector3(), t: new THREE.Vector3(), vp: [0, 0, 0], vt: [0, 0, 0], init: false };
  const presence = { ring: 1, ringV: 0, orbit: 0, orbitV: 0 };
  const projected = new THREE.Vector3();
  let firstFrame = true;
  let telemetryAt = 0;

  function frame(dt: number, elapsed: number): void {
    const rawT = rig.read();
    const t = reducedMotion ? Math.round(rawT) : rawT;
    const pose = samplePose(stage.portrait ? portraitTracks(stage.width / stage.height) : landscapeTracks(stage.width / stage.height), t);

    const px = springStep(parallax.x, pointer.active ? pointer.x : 0, parallax.vx, 0.8, dt);
    const py = springStep(parallax.y, pointer.active ? pointer.y : 0, parallax.vy, 0.8, dt);
    parallax.x = px.value; parallax.vx = px.velocity;
    parallax.y = py.value; parallax.vy = py.velocity;
    const drift = reducedMotion ? 0 : 1.4;

    const goalP = [pose.position[0] + parallax.x * drift, pose.position[1] - parallax.y * drift * 0.5, pose.position[2]];
    const goalT = pose.target;
    if (!cam.init || reducedMotion) {
      cam.p.set(goalP[0], goalP[1], goalP[2]);
      cam.t.set(goalT[0], goalT[1], goalT[2]);
      cam.init = true;
    } else {
      for (let axis = 0; axis < 3; axis += 1) {
        const p = springStep(cam.p.getComponent(axis), goalP[axis], cam.vp[axis], 0.45, dt);
        cam.p.setComponent(axis, p.value); cam.vp[axis] = p.velocity;
        const q = springStep(cam.t.getComponent(axis), goalT[axis], cam.vt[axis], 0.45, dt);
        cam.t.setComponent(axis, q.value); cam.vt[axis] = q.velocity;
      }
    }
    camera.position.copy(cam.p);
    camera.lookAt(cam.t);
    stage.setFov(pose.fov);
    host.style.setProperty('--pw-stage-opacity', pose.stage.toFixed(3));

    // ---- presences --------------------------------------------------------
    const ringGoal = sampleBySection(RING_PRESENCE, t);
    const orbitGoal = sampleBySection(ORBIT_PRESENCE, t);
    if (reducedMotion) {
      presence.ring = ringGoal;
      presence.orbit = orbitGoal;
    } else {
      const ring = springStep(presence.ring, ringGoal, presence.ringV, 0.6, dt);
      presence.ring = ring.value; presence.ringV = ring.velocity;
      const orbit = springStep(presence.orbit, orbitGoal, presence.orbitV, 0.6, dt);
      presence.orbit = orbit.value; presence.orbitV = orbit.velocity;
    }
    const time = reducedMotion ? 0 : elapsed;
    circleUniforms.uTime.value = time;
    circleUniforms.uRing.value = presence.ring;
    glyphs.update(time, presence.ring, stage.height * stage.dpr * 0.5 / Math.tan((camera.fov * DEG) / 2));
    fragments.update(time);
    orbitDefs.forEach((def, i) => {
      orbits[i].setHead(reducedMotion ? def.offset : (def.offset + time * def.speed) % 1);
      orbits[i].setPresence(presence.orbit);
    });

    // ---- the Dog ----------------------------------------------------------
    const index = Math.min(DOG_INTENT.length - 1, Math.max(0, Math.round(t)));
    const intent = DOG_INTENT[index];
    const current = animator.currentPose;
    const walking = Math.abs(current.rootX - intent.x) > 0.35;
    const dogPose = animator.update(reducedMotion ? 0 : dt, {
      state: walking ? 'WALK' : intent.state,
      x: intent.x,
      z: 0,
      yaw: intent.yaw,
      look: pointer.active ? { x: parallax.x, y: parallax.y } : null,
    });
    dog.applyPose(dogPose);
    shadowUniforms.uDog.value.set(dogPose.rootX, dogPose.rootZ);

    stage.render();

    // ---- DOM hooks: role labels and measured telemetry ----------------------
    if (hooks.onRoleAnchors) {
      hooks.onRoleAnchors(roleLabelPoints.map((point) => {
        projected.copy(point).project(camera);
        const x = (projected.x * 0.5 + 0.5) * stage.width;
        const y = (-projected.y * 0.5 + 0.5) * stage.height;
        const margin = 72;
        return {
          x,
          y,
          presence: presence.orbit,
          visible: projected.z < 1 && x > margin && x < stage.width - margin && y > margin && y < stage.height - margin,
        };
      }));
    }
    if (hooks.onTelemetry && elapsed - telemetryAt > 0.5) {
      telemetryAt = elapsed;
      hooks.onTelemetry({ width: stage.width, height: stage.height, dpr: stage.dpr, fps: loop.fps, tier });
    }

    if (firstFrame) {
      firstFrame = false;
      host.dataset.ready = 'true';
      window.setTimeout(() => { host.dataset.live = 'true'; }, 1500);
    }
  }

  loop.start();

  return {
    dispose() {
      loop.dispose();
      layoutObserver.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      groundGeometry.dispose();
      shadowMaterial.dispose();
      circleMaterial.dispose();
      glyphs.dispose();
      fragments.dispose();
      orbits.forEach((orbit) => orbit.dispose());
      dog.dispose();
      materials.dispose();
      stage.dispose();
    },
  };
}

const WORLD_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;

/** Small plus-shaped glyphs rising from the circle and fading — the art direction's sparks. */
function buildGlyphs(count: number) {
  const seeds = new Float32Array(count * 4);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const h = (n: number) => { const s = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453; return s - Math.floor(s); };
    seeds.set([h(1) * Math.PI * 2, 9.8 + h(2) * 4.4, 0.05 + h(3) * 0.08, h(4)], i * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const uniforms = { uTime: { value: 0 }, uPresence: { value: 1 }, uScale: { value: 400 }, uColor: { value: new THREE.Color(VIOLET_CORE) } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uScale;
      varying float vLife;
      void main() {
        float life = fract(uTime * aSeed.z + aSeed.w);
        float angle = aSeed.x + uTime * 0.018;
        vec3 p = vec3(cos(angle) * aSeed.y, 0.4 + life * 9.0, sin(angle) * aSeed.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 0.9 * uScale / -mv.z;
        vLife = life;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPresence;
      uniform vec3 uColor;
      varying float vLife;
      void main() {
        vec2 c = abs(gl_PointCoord - 0.5);
        float plus = max(step(c.x, 0.07) * step(c.y, 0.42), step(c.y, 0.07) * step(c.x, 0.42));
        float fade = smoothstep(0.0, 0.18, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife));
        float a = plus * fade * 0.75 * uPresence;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  const object = new THREE.Points(geometry, material);
  object.frustumCulled = false;
  return {
    object,
    update(time: number, presence: number, scale: number) {
      uniforms.uTime.value = time;
      uniforms.uPresence.value = presence;
      uniforms.uScale.value = scale;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

/** Ivory voxels at a distance: the rest of the world, suggested, never shown whole. */
function buildFragments(material: THREE.Material, count: number) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const seeds = Array.from({ length: count }, (_, i) => {
    const h = (n: number) => { const s = Math.sin((i + 3) * 91.345 + n * 47.853) * 43758.5453; return s - Math.floor(s); };
    // BEHIND the Dog and far to the sides — never between a camera and its
    // subject. Every shot looks from the +Z half, so the fragments live deep in
    // -Z, where the fog can do its work on them.
    // Weighted to the right of frame, where the Dog stands, so the copy column
    // stays clear; far enough that the fog turns most of them into silhouettes.
    const side = h(1) < 0.72 ? 1 : -1;
    const deep = h(2);
    return {
      x: side * (20 + h(7) * 110) * (0.4 + deep * 0.6),
      z: -90 - deep * 120,
      y: 6 + h(3) * 64,
      size: 1.4 + Math.pow(h(4), 2) * 4.6,
      spin: (h(5) - 0.5) * 0.12,
      phase: h(6) * Math.PI * 2,
    };
  });
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const update = (time: number) => {
    seeds.forEach((seed, i) => {
      euler.set(seed.phase + time * seed.spin, seed.phase * 1.7 + time * seed.spin * 0.7, 0);
      quaternion.setFromEuler(euler);
      position.set(seed.x, seed.y + Math.sin(time * 0.21 + seed.phase) * 0.8, seed.z);
      scale.setScalar(seed.size);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return {
    object: mesh,
    update,
    dispose() { geometry.dispose(); mesh.dispose(); },
  };
}
