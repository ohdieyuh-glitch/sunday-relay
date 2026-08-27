import * as THREE from 'three';
import { AQUALA_MARK_SPEC, buildAqualaMarkGeometry } from './aquala-mark';
import { buildDogMesh, type DogMesh } from './dog-mesh';
import { createLandingMaterials, LANDING_COLORS, type QualityTier } from './materials';
import { createSignalTracer, type SignalTracer } from './tracer';
import type { DogPose } from './dog-rig';
import type { Vec3 } from '../choreography';

/**
 * THE LANDING'S WEBGL HOST.
 *
 * One renderer, one scene, one camera, for the whole page. Both references
 * treat the render as the page rather than as a widget inside it, and this is
 * the mechanical form of that: nothing here is torn down and rebuilt between
 * beats, so there is never a reload hitch mid-scroll.
 *
 * The engine owns everything expensive and exposes a single `render(frame)`.
 * It deliberately does NOT own the animation loop or the scroll listener —
 * React owns those, so that a component unmount cannot leave a loop running.
 */

export type EngineFrame = {
  readonly cameraPosition: Vec3;
  readonly cameraTarget: Vec3;
  readonly fov: number;
  readonly dogPose: DogPose;
  readonly dogPresence: number;
  readonly aqualaPresence: number;
  /** Recent scroll velocity, 0..1, used to drive the signal's speed. */
  readonly flow: number;
  /** Normalised pointer, -1..1, or null. Drives the mark's tilt. */
  readonly pointer: { x: number; y: number } | null;
  readonly elapsed: number;
};

export type LandingEngine = {
  render(frame: EngineFrame): void;
  resize(width: number, height: number): void;
  /** Project a world anchor to CSS pixels, with a depth for layering. */
  project(anchor: Vec3): { x: number; y: number; depth: number; visible: boolean };
  readonly tier: QualityTier;
  dispose(): void;
};

/**
 * QUALITY TIERING.
 *
 * Chosen once, from device signals, and never re-evaluated mid-session —
 * a tier that flips under load produces a visible pop, which is worse than the
 * frame it saved. The founder's rule holds: degrade the expensive effects,
 * never remove the 3D content.
 */
export function chooseTier(width: number, deviceMemory: number | undefined, cores: number | undefined): QualityTier {
  if (width < 720) return 'low';
  if ((deviceMemory !== undefined && deviceMemory <= 4) || (cores !== undefined && cores <= 4)) return 'medium';
  return 'high';
}

/** Device pixel ratio is capped: past ~2 the cost is quadratic and invisible. */
export function chooseDpr(rawDpr: number, tier: QualityTier): number {
  const ceiling = tier === 'high' ? 2 : tier === 'medium' ? 1.75 : 1.5;
  return Math.min(Math.max(rawDpr, 1), ceiling);
}

const AQUALA_SCALE = 5.2;
const AQUALA_ORIGIN = new THREE.Vector3(0, 16, 0);

/**
 * THE LIGHT RIG, exported so the Dog's reference-comparison renders use the
 * SAME lights the site does. A proof lit differently from the product is not a
 * proof — the first version of that harness carried its own copy of this rig
 * and kept reporting a blue Dog after the blue had been fixed here.
 */
export function addLandingLights(scene: THREE.Scene): THREE.PointLight {
  // ---- lighting --------------------------------------------------------
  // ONE dominant key, a cool rim, and a fill kept FAR below the key. A fill at
  // parity with the key means nothing in the frame can be in shade, and the
  // whole image flattens into one material — a mistake already paid for once on
  // this product, where a shadowless fill ran at 122% of the key.
  // COOL-NEUTRAL, NOT WARM. A warm key over a warm ivory pushes the body
  // through khaki into tan under ACES — the frame then reads as one brown
  // material, which is a failure this product has diagnosed before. The warmth
  // belongs to the gold eyes; the body's warmth is already in its albedo.
  const key = new THREE.DirectionalLight(0xfffaf0, 3.4);
  key.position.set(-14, 26, 18);
  scene.add(key);

  // THE BLUE RIM IS AN EDGE, NOT A LIGHT SOURCE.
  //
  // At 1.9 it was the only thing reaching the Dog's back and sides, so every
  // view except the front rendered the character CYAN — the exact failure the
  // founder ruled out by name. Baby-blue belongs to Aquala: it is the mark's
  // illumination and the signal's colour, and it has no business being the key
  // light on an ivory body.
  const rim = new THREE.DirectionalLight(LANDING_COLORS.aqualaLight, 0.5);
  rim.position.set(18, 12, -20);
  scene.add(rim);

  // A warm-neutral back fill so the far side of the Dog reads as ivory in
  // shadow rather than as a blue silhouette. Kept well below the key so the
  // form still has a lit side and a shaded side.
  const backFill = new THREE.DirectionalLight(0xfff6e8, 1.25);
  backFill.position.set(-8, 11, -24);
  scene.add(backFill);

  // A neutral side fill. Both the key and the back fill sit on -X, so without
  // this the Dog's +X flank saw nothing but the blue rim and rendered slate —
  // visible in the product at three-quarter, not only in the proof renders.
  const sideFill = new THREE.DirectionalLight(0xf6f0e6, 0.95);
  sideFill.position.set(22, 14, 8);
  scene.add(sideFill);

  // Soft NEUTRAL ambient. The previous sky colour was itself blue, which
  // compounded the cast it was supposed to balance.
  const fill = new THREE.HemisphereLight(0x5c5548, 0x101014, 0.7);
  scene.add(fill);

  // The mark's internal glow. A point light INSIDE the extrusion is what makes
  // the translucent body light up from within instead of merely being lit.
  const core = new THREE.PointLight(LANDING_COLORS.aqualaCore, 26, 42, 2);
  core.position.copy(AQUALA_ORIGIN);
  scene.add(core);

  return core;
}

export function createLandingEngine(
  canvas: HTMLCanvasElement,
  tier: QualityTier,
  dpr: number,
): LandingEngine {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier !== 'low',
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(LANDING_COLORS.void, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Below 1.0 the cream reads grey; above ~1.25 the gold eyes clip to white and
  // take the whole face with them.
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LANDING_COLORS.void);
  // Distance fog, not a gradient backdrop. It is what makes the Wonderland
  // opening in beat 7 read as FAR rather than small.
  scene.fog = new THREE.Fog(LANDING_COLORS.void, 55, 190);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 400);
  const materials = createLandingMaterials(tier);

  const core = addLandingLights(scene);

  // ---- Aquala mark -----------------------------------------------------
  const aqualaGroup = new THREE.Group();
  aqualaGroup.position.copy(AQUALA_ORIGIN);
  aqualaGroup.scale.setScalar(AQUALA_SCALE);
  const aqualaGeometries = buildAqualaMarkGeometry(AQUALA_MARK_SPEC);
  for (const geometry of aqualaGeometries) {
    aqualaGroup.add(new THREE.Mesh(geometry, materials.aquala));
  }
  scene.add(aqualaGroup);

  // ---- signal ----------------------------------------------------------
  const tracer: SignalTracer = createSignalTracer(
    tier === 'high' ? 10 : 6,
    tier === 'high' ? 420 : tier === 'medium' ? 280 : 180,
  );
  tracer.object.position.copy(AQUALA_ORIGIN);
  tracer.object.scale.setScalar(AQUALA_SCALE);
  scene.add(tracer.object);

  // ---- Dog -------------------------------------------------------------
  const dog: DogMesh = buildDogMesh(materials);
  scene.add(dog.root);

  // ---- ground ----------------------------------------------------------
  // A shader-drawn contact shadow and horizon fade. No texture is fetched and
  // no CSS `url()` is involved — this frontend forbids both outright.
  const groundMaterial = new THREE.ShaderMaterial({
    uniforms: { uDogX: { value: 0 }, uDogZ: { value: 0 }, uPresence: { value: 0 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDogX; uniform float uDogZ; uniform float uPresence;
      varying vec3 vWorld;
      void main() {
        float contact = 1.0 - smoothstep(0.0, 7.0, length(vWorld.xz - vec2(uDogX, uDogZ)));
        float horizon = 1.0 - smoothstep(20.0, 120.0, length(vWorld.xz));
        float grid = 0.0;
        vec2 g = abs(fract(vWorld.xz * 0.05) - 0.5);
        grid = (1.0 - smoothstep(0.0, 0.02, min(g.x, g.y))) * 0.05 * horizon;
        float shade = contact * 0.55 * uPresence;
        gl_FragColor = vec4(vec3(0.62, 0.85, 1.0) * grid, grid + shade);
      }
    `,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300, 1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.02;
  scene.add(ground);

  const target = new THREE.Vector3();
  const projected = new THREE.Vector3();
  let viewWidth = 1;
  let viewHeight = 1;
  let aspect = 1;

  return {
    tier,
    resize(width, height) {
      viewWidth = Math.max(1, width);
      viewHeight = Math.max(1, height);
      renderer.setSize(viewWidth, viewHeight, false);
      aspect = viewWidth / viewHeight;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    render(frame) {
      camera.position.set(frame.cameraPosition[0], frame.cameraPosition[1], frame.cameraPosition[2]);
      target.set(frame.cameraTarget[0], frame.cameraTarget[1], frame.cameraTarget[2]);
      camera.lookAt(target);
      // HORIZONTAL FIELD OF VIEW IS LOCKED IN PORTRAIT.
      //
      // A perspective camera's `fov` is VERTICAL, so a portrait viewport keeps
      // the vertical framing and narrows the horizontal one — which on a phone
      // sliced the Dog off the right edge entirely while the desktop shot was
      // correctly composed. Converting the vertical fov so the HORIZONTAL angle
      // matches the desktop's is what "adapt the camera, don't just shrink the
      // desktop" means in practice.
      const fov =
        aspect < 1
          ? (2 * Math.atan(Math.tan((frame.fov * Math.PI) / 360) / aspect) * 180) / Math.PI
          : frame.fov;
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      // The mark tilts toward the pointer and drifts on a slow, incommensurate
      // pair of frequencies. It is deliberately NOT spun about Y: the founder's
      // note is explicit that it must not rotate like a crypto coin.
      const px = frame.pointer?.x ?? 0;
      const py = frame.pointer?.y ?? 0;
      aqualaGroup.rotation.x = py * 0.2 + Math.sin(frame.elapsed * 0.21) * 0.035;
      aqualaGroup.rotation.y = px * 0.3 + Math.sin(frame.elapsed * 0.17) * 0.05;
      aqualaGroup.position.y = AQUALA_ORIGIN.y + Math.sin(frame.elapsed * 0.33) * 0.35;
      aqualaGroup.visible = frame.aqualaPresence > 0.01;
      aqualaGroup.scale.setScalar(AQUALA_SCALE * (0.86 + 0.14 * frame.aqualaPresence));
      core.intensity = 26 * frame.aqualaPresence;

      tracer.object.position.y = aqualaGroup.position.y;
      tracer.object.rotation.copy(aqualaGroup.rotation);
      tracer.update(frame.elapsed, frame.flow, frame.aqualaPresence);

      dog.applyPose(frame.dogPose);
      dog.root.visible = frame.dogPresence > 0.01;
      dog.root.scale.setScalar(0.85 + 0.15 * frame.dogPresence);
      groundMaterial.uniforms.uDogX.value = frame.dogPose.rootX;
      groundMaterial.uniforms.uDogZ.value = frame.dogPose.rootZ;
      groundMaterial.uniforms.uPresence.value = frame.dogPresence;

      renderer.render(scene, camera);
    },
    project(anchor) {
      projected.set(anchor[0], anchor[1], anchor[2]).project(camera);
      const x = (projected.x * 0.5 + 0.5) * viewWidth;
      const y = (-projected.y * 0.5 + 0.5) * viewHeight;
      // Culled against the VIEWPORT, not merely against the near/far planes. An
      // anchor behind the camera or off to the side still yields finite screen
      // coordinates, and the chips for those bled in as clipped fragments at the
      // edges of the phone frame.
      const margin = 96;
      return {
        x,
        y,
        depth: projected.z,
        visible:
          projected.z > -1 && projected.z < 1 &&
          x > margin && x < viewWidth - margin &&
          y > margin && y < viewHeight - margin,
      };
    },
    dispose() {
      aqualaGeometries.forEach((g) => g.dispose());
      tracer.dispose();
      dog.dispose();
      ground.geometry.dispose();
      groundMaterial.dispose();
      materials.dispose();
      renderer.dispose();
    },
  };
}
