// The Relay Dog, walking, in a browser — from the engine's own numbers.
//
// Two things here are deliberately NOT authored in this file:
//
//   * the body. dog-body.json is generated from WonderlandDogBody.cpp by
//     emit-dog-body.py. Retyping that table is how this project once shipped a
//     168 uu Dog against a real 338 uu one.
//   * the walk. gait.js mirrors WonderlandDogGait.cpp and is checked
//     sample-for-sample against a golden the C++ emits.
//
// So a slide seen here is a slide the engine has, and a slide absent here is
// absent there. That is the only reason watching this is worth anything.
//
// PAW TRAILS ARE THE POINT. "Does it look smooth" is a judgement; "does the
// planted paw leave a stationary dot" is not. Each paw drops a marker at the
// world position it is standing on, so skating shows up as a smear of dots
// where a walk leaves four clean clusters.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as gait from './gait.js';

const UU = 0.01;          // Unreal units -> metres, so the camera works in sane numbers
const LIFT = 18;          // uu, peak paw lift
const BOB = 3;            // uu, body bob

const body = await (await fetch('./dog-body.json')).json();

// A CAPTURE HAS TO BE REPRODUCIBLE. Clicking three buttons before recording is
// not a procedure anyone can repeat, and "the view I happened to have" is how
// two captures get compared that were never the same shot. Everything the
// controls do is also a query parameter, so a screencast command line IS the
// configuration:  ?view=side&slow=1&speed=130&stride=120&trails=0
const Q = new URLSearchParams(location.search);
const qnum = (k, d) => (Q.has(k) && Number.isFinite(+Q.get(k)) ? +Q.get(k) : d);
const qbool = (k, d) => (Q.has(k) ? Q.get(k) !== '0' && Q.get(k) !== 'false' : d);

// ---------------------------------------------------------------- scene
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft is deprecated in this three build
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#131020');
scene.fog = new THREE.Fog('#131020', 14, 46);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 400);
// THE AXES, ONCE, SO THE CAMERAS ARE NOT GUESSES. toThree below maps
// (x,y,z)_UE -> (y, z, -x), so the Dog's NOSE (+X) points down -Z and its RIGHT
// (+Y) is +X. A camera parked on +Z therefore looks the Dog in the face — which
// is what the first "side view" did, and a head-on shot is the one angle from
// which a gait is invisible. A profile is a camera on +X.
camera.position.set(7.4, 1.9, 0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.7, 0);
controls.enableDamping = true;

// Light it so the SILHOUETTE reads and the ground contact is visible — a
// contact shadow is what tells the eye a paw is touching rather than hovering,
// and hovering is one of the things being checked.
const key = new THREE.DirectionalLight('#fff4e0', 2.6);
key.position.set(5, 9, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -8; key.shadow.camera.right = 8;
key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
key.shadow.bias = -0.0008;
scene.add(key);
scene.add(new THREE.HemisphereLight('#b9a6ff', '#241c38', 1.15));
const rim = new THREE.DirectionalLight('#ff9ad5', 1.0);
rim.position.set(-6, 3, -5);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: '#2a2340', roughness: 0.94, metalness: 0.0 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(120, 120, '#4a3d6b', '#33294d');
grid.material.opacity = 0.45; grid.material.transparent = true;
scene.add(grid);

// ---------------------------------------------------------------- the Dog
// Built from the generated table. Every part is a unit cube scaled by the row,
// exactly as UE does it: /Engine/BasicShapes/Cube is 100 uu at scale 1.
const cube = new THREE.BoxGeometry(1, 1, 1);
const mats = {};
for (const [name, spec] of Object.entries(body.palette)) {
  mats[name] = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.color),
    roughness: spec.role === 'eye' ? 0.25 : 0.62,
    metalness: spec.role === 'trim' ? 0.7 : 0.04,
    emissive: new THREE.Color(spec.color),
    emissiveIntensity: spec.emissive,
  });
}

// UE is Z-up, X-forward, Y-right; three is Y-up. The mapping used here is
// (x, y, z)_UE -> (y, z, -x)_three so +X (the Dog's nose) points down -Z, which
// is the direction the default camera looks along.
function toThree(v) { return new THREE.Vector3(v[1] * UU, v[2] * UU, -v[0] * UU); }

const dog = new THREE.Group();
scene.add(dog);
const torsoPivot = new THREE.Group();   // bob, pitch and roll ride here
dog.add(torsoPivot);

const partMeshes = [];
body.parts.forEach((p, i) => {
  const m = new THREE.Mesh(cube, mats[p.mat]);
  m.scale.set(p.scale[1] * body.unitsPerCube * UU,
              p.scale[2] * body.unitsPerCube * UU,
              p.scale[0] * body.unitsPerCube * UU);
  m.position.copy(toThree(p.loc));
  m.castShadow = true; m.receiveShadow = true;
  m.userData.rest = m.position.clone();
  partMeshes.push(m);
  // Legs hang off the root so the torso's bob does not carry them; everything
  // else rides the torso pivot, which is what makes the body breathe over the
  // legs instead of the whole Dog jittering as one lump.
  (body.legRows.includes(i) ? dog : torsoPivot).add(m);
});
const legMeshes = body.legRows.map(i => partMeshes[i]);

// ---------------------------------------------------------------- paw trails
const TRAIL = 260;
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL * 3).fill(9999);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
const trailCol = new Float32Array(TRAIL * 3);
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trails = new THREE.Points(trailGeo, new THREE.PointsMaterial({
  size: 0.075, vertexColors: true, sizeAttenuation: true }));
scene.add(trails);
let trailAt = 0;
const LEG_COLOR = [[1, .42, .55], [.42, .82, 1], [1, .82, .35], [.55, 1, .62]];

function dropTrail(x, z, leg) {
  const i = (trailAt % TRAIL) * 3;
  trailPos[i] = x; trailPos[i + 1] = 0.015; trailPos[i + 2] = z;
  trailCol[i] = LEG_COLOR[leg][0]; trailCol[i + 1] = LEG_COLOR[leg][1];
  trailCol[i + 2] = LEG_COLOR[leg][2];
  trailAt++;
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- controls
const ui = {
  speed: document.getElementById('c-speed'),
  stride: document.getElementById('c-stride'),
  trails: document.getElementById('c-trails'),
  slow: document.getElementById('c-slow'),
  side: document.getElementById('c-side'),
};
const h = id => document.getElementById(id);
ui.trails.onclick = () => {
  const on = ui.trails.getAttribute('aria-pressed') !== 'true';
  ui.trails.setAttribute('aria-pressed', String(on)); trails.visible = on;
};
ui.slow.onclick = () => ui.slow.setAttribute('aria-pressed',
  String(ui.slow.getAttribute('aria-pressed') !== 'true'));
function setSide(on) {
  ui.side.setAttribute('aria-pressed', String(on));
  // Profile: straight down the lateral axis, so all four legs are separable and
  // a stride is a horizontal distance the eye can measure against the trails.
  // Three-quarter: swung round toward the nose, which reads as a Dog.
  if (on) { camera.position.set(7.4, 1.9, 0); }
  else { camera.position.set(5.4, 2.4, -5.4); }
  controls.target.set(0, 1.7, 0);
}
ui.side.onclick = () => setSide(ui.side.getAttribute('aria-pressed') !== 'true');

// Apply the query parameters, then let the buttons take over.
ui.speed.value = String(qnum('speed', 130));
ui.stride.value = String(qnum('stride', 120));
if (qbool('slow', false)) ui.slow.setAttribute('aria-pressed', 'true');
if (!qbool('trails', true)) { ui.trails.setAttribute('aria-pressed', 'false'); trails.visible = false; }
setSide(Q.get('view') === 'side');

// ---------------------------------------------------------------- the walk
let distance = 0;            // uu travelled — the ONLY thing driving the gait
let prevStance = [true, true, true, true];
const order = [];
let worstSlip = 0;
const anchor = [null, null, null, null];
let last = performance.now(), fps = 60;

// The Dog stays at the origin and the WORLD moves, so it never walks out of
// frame. Foot lock is unaffected: what matters is that a planted paw is
// stationary relative to the ground, and the ground is what is moving.
function frame(now) {
  const dtRaw = Math.min((now - last) / 1000, 0.1);
  last = now;
  fps = fps * 0.9 + (1 / Math.max(dtRaw, 1e-4)) * 0.1;
  const slowed = ui.slow.getAttribute('aria-pressed') === 'true' ? 0.25 : 1;
  const dt = dtRaw * slowed;

  const speed = Number(ui.speed.value);         // uu/s
  const stride = Number(ui.stride.value);       // uu
  distance += speed * dt;

  // Scroll the ground and the trails by the distance walked.
  const groundShift = (distance * UU) % 1;
  grid.position.z = groundShift;
  trails.position.z = distance * UU;

  let down = 0;
  legMeshes.forEach((mesh, leg) => {
    const phase = distance / stride + gait.legPhaseOffset(leg);
    const pose = gait.legPose(phase, stride, LIFT);
    // +X forward in UE is -Z in three, so a positive forward offset moves -Z.
    mesh.position.z = mesh.userData.rest.z - pose.forward * UU;
    mesh.position.y = mesh.userData.rest.y + pose.lift * UU;
    if (pose.stance) {
      down++;
      // World position along the travel axis, in the ground's frame.
      const world = (distance + pose.forward) * UU;
      if (!prevStance[leg]) { anchor[leg] = world; order.push(leg); if (order.length > 8) order.shift(); }
      else if (anchor[leg] !== null) worstSlip = Math.max(worstSlip, Math.abs(world - anchor[leg]));
      // WHERE THE PAW ACTUALLY IS, not a second derivation of it. The first
      // version recomputed the marker's position from distance and forward
      // offset and got it wrong by a whole `distance` — the trails sat in a
      // line at the bottom of frame, nowhere near a paw, which makes the one
      // thing they exist to show unreadable. The mesh has already been placed;
      // subtracting the group's own offset converts that to group-local space
      // and cannot disagree with what is on screen.
      if (trails.visible) {
        dropTrail(mesh.position.x, mesh.position.z - trails.position.z, leg);
      }
    } else {
      anchor[leg] = null;
    }
    prevStance[leg] = pose.stance;
  });

  const bp = gait.bodyPose(distance / stride, BOB);
  torsoPivot.position.y = bp.bob * UU;
  torsoPivot.rotation.x = THREE.MathUtils.degToRad(bp.pitch);
  torsoPivot.rotation.z = THREE.MathUtils.degToRad(bp.roll);

  h('h-speed').textContent = `${speed} uu/s (${(speed / 100).toFixed(2)} m/s)`;
  h('h-stride').textContent = `${stride} uu · duty ${gait.WALK_DUTY_FACTOR}`;
  h('h-down').innerHTML = down >= 2
    ? `<span class="good">${down}</span>` : `<span class="bad">${down}</span>`;
  h('h-order').textContent = order.map(l => ['LH', 'RH', 'LF', 'RF'][l]).join(' ');
  h('h-slip').innerHTML = worstSlip < 0.002
    ? `<span class="good">${(worstSlip * 100).toFixed(3)} cm</span>`
    : `<span class="bad">${(worstSlip * 100).toFixed(3)} cm</span>`;
  h('h-fps').textContent = fps.toFixed(0);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  const w = innerWidth, hgt = innerHeight;
  renderer.setSize(w, hgt);
  camera.aspect = w / hgt; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// Let a headless capture drive the clock instead of the wall, so a frame grab
// is deterministic and a video is not at the mercy of the renderer's speed.
globalThis.__gait = {
  seek(uu) { distance = uu; },
  get distance() { return distance; },
  get worstSlipCm() { return worstSlip * 100; },
};
