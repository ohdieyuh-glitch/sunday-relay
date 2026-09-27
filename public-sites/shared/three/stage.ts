import * as THREE from 'three';
import { chooseDpr, chooseTier } from '../../../src/relay/ui/landing/three/engine';
import type { QualityTier } from '../../../src/relay/ui/landing/three/materials';

/**
 * THE STAGE — one renderer, one scene, one camera per site.
 *
 * Renderer settings are the landing's, on purpose: ACES filmic at 1.25
 * exposure (below 1.0 the cream reads grey; above ~1.25 the gold eyes clip),
 * sRGB output, distance fog into the void rather than a gradient backdrop.
 * Quality tier and DPR ceiling come from the landing's own policy functions,
 * imported rather than restated, so all three surfaces degrade the same way.
 */

export type Stage = {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly tier: QualityTier;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly portrait: boolean;
  /** Apply a vertical fov, widened in portrait so the HORIZONTAL angle holds. */
  setFov(fov: number): void;
  resize(): void;
  render(): void;
  dispose(): void;
};

export const VOID = 0x05060a;

export function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createStage(
  canvas: HTMLCanvasElement,
  options: { readonly fogNear: number; readonly fogFar: number },
): Stage {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const tier = chooseTier(window.innerWidth, nav.deviceMemory, nav.hardwareConcurrency);
  const dpr = chooseDpr(window.devicePixelRatio || 1, tier);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier !== 'low',
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(VOID, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID);
  scene.fog = new THREE.Fog(VOID, options.fogNear, options.fogFar);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 500);

  let width = 1;
  let height = 1;
  let requestedFov = 34;

  const applyFov = () => {
    const aspect = width / height;
    // A perspective camera's fov is VERTICAL, so portrait keeps the vertical
    // framing and slices the subject off the sides. Convert so the horizontal
    // angle matches a 1:1 frame — the landing's fix, verbatim in intent.
    const fov = aspect < 1
      ? (2 * Math.atan(Math.tan((requestedFov * Math.PI) / 360) / aspect) * 180) / Math.PI
      : requestedFov;
    if (camera.fov !== fov || camera.aspect !== aspect) {
      camera.fov = fov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
  };

  const stage: Stage = {
    renderer,
    scene,
    camera,
    tier,
    dpr,
    get width() { return width; },
    get height() { return height; },
    get portrait() { return width < height; },
    setFov(fov) {
      requestedFov = fov;
      applyFov();
    },
    resize() {
      width = Math.max(1, canvas.clientWidth || window.innerWidth);
      height = Math.max(1, canvas.clientHeight || window.innerHeight);
      renderer.setSize(width, height, false);
      applyFov();
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
    },
  };
  stage.resize();
  return stage;
}

/**
 * The light rig, adapted from the landing's `addLandingLights`: one dominant
 * cool-neutral key, fills kept far below it, a neutral hemisphere. The only
 * change is the rim, which takes each site's own light colour instead of the
 * retired mark's blue — and stays an EDGE (0.5), because at higher intensity
 * the rim becomes the key on the Dog's back and tints the ivory.
 */
export function addStageLights(scene: THREE.Scene, rimColor: number, rimIntensity = 0.5): void {
  const key = new THREE.DirectionalLight(0xfffaf0, 3.4);
  key.position.set(-14, 26, 18);
  scene.add(key);

  const rim = new THREE.DirectionalLight(rimColor, rimIntensity);
  rim.position.set(18, 12, -20);
  scene.add(rim);

  const backFill = new THREE.DirectionalLight(0xfff6e8, 1.25);
  backFill.position.set(-8, 11, -24);
  scene.add(backFill);

  const sideFill = new THREE.DirectionalLight(0xf6f0e6, 0.95);
  sideFill.position.set(22, 14, 8);
  scene.add(sideFill);

  scene.add(new THREE.HemisphereLight(0x5c5548, 0x101014, 0.7));
}
