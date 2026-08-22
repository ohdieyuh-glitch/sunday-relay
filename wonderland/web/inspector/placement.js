// Apply the placement contract. Deliberately arithmetic-free beyond matrix
// multiplication.
//
// placement.py composes the chain and placement_contract.py writes down its
// RESULT: a basis, a scale, an origin, an offset, already multiplied out. This
// file turns those numbers into a THREE.Matrix4 and nothing else. It does not
// know what an axis correction is, it cannot disagree with Unreal about one,
// and there is no second implementation here to drift.
//
// That matters more than it sounds. This inspector exists to CATCH flipped and
// mis-scaled imports; an inspector that computed placement its own way would
// reproduce the bug it was built to find.
import * as THREE from 'three';

/** Row-major 3x3 from the contract -> THREE.Matrix4 (rotation only). */
export function basisMatrix(rows) {
  const m = new THREE.Matrix4();
  m.set(
    rows[0][0], rows[0][1], rows[0][2], 0,
    rows[1][0], rows[1][1], rows[1][2], 0,
    rows[2][0], rows[2][1], rows[2][2], 0,
    0, 0, 0, 1,
  );
  return m;
}

/**
 * glTF scene space (node transforms already applied by GLTFLoader) -> Unreal cm.
 * The loader bakes the node hierarchy, which is exactly what Unreal's importer
 * does, so node_rotation_rows must NOT be applied again here.
 */
export function unrealPlacement(contract) {
  const p = contract.placement;
  const basis = basisMatrix(p.basis_rows);
  const scale = new THREE.Matrix4().makeScale(
    p.unreal_units_per_gltf_unit, p.unreal_units_per_gltf_unit, p.unreal_units_per_gltf_unit);
  const translate = new THREE.Matrix4().makeTranslation(
    p.origin_cm[0], p.origin_cm[1], p.origin_cm[2] + (p.z_offset_cm || 0));
  return translate.multiply(scale).multiply(basis);
}

/** Unreal (left-handed Z-up) -> three.js (right-handed Z-up here). */
export function handedness(contract) {
  return basisMatrix(contract.handedness.ue_to_three_rows);
}

/** A point given in Unreal cm, expressed in the scene's three.js space. */
export function ueToThree(contract, v) {
  return v.clone().applyMatrix4(handedness(contract));
}

/** Unreal rotator -> unit forward vector, matching placement.forward_from_rotator. */
export function forwardFromRotator(pitchDeg, yawDeg) {
  const p = THREE.MathUtils.degToRad(pitchDeg);
  const y = THREE.MathUtils.degToRad(yawDeg);
  return new THREE.Vector3(Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p));
}

/** Unreal's horizontal FOV -> three.js PerspectiveCamera vertical FOV. */
export function verticalFov(horizontalDeg, aspect) {
  const half = THREE.MathUtils.degToRad(horizontalDeg) * 0.5;
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / aspect));
}
