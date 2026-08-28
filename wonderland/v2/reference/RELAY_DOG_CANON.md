# The canonical Relay Dog — measured from the shipping web model
Source: `src/relay/ui/landing/three/relay-dog.ts` @ main 96451fc (DOG_BOXES/DOG_PIVOTS), `dog-mesh.ts`, `materials.ts`. Read-only audit — the web dog is the CANON and is never modified.
All numbers are NORMALISED TO HEAD_WIDTH (W = 1.0; the web build uses W = 7.2 scene units). Web axes: X right, Y up, Z toward the viewer (front face at +Z). Unreal mapping: X_ue = Z_web(forward) → use UE +X = web +Z, UE +Y = web +X (right), UE +Z = web +Y (up); a uniform scale S_uu sets 1.0 W = S_uu centimetres.

## Headline ratios (HEAD_WIDTH = 1.000)
| measure | ×W |
|---|---|
| total height (ground → ear top) | 2.9025 |
| head block height (shoulder line → head top, excl. ears) | 0.8 |
| head depth | 0.725 |
| torso width | 0.62 |
| torso height (pelvis top → shoulder line) | 0.875 |
| torso depth (upper/mid) | 0.45 |
| lower torso width / pelvis step width | 0.4875 |
| pelvis step width | 0.3625 |
| visor width | 0.65 |
| visor height | 0.3 |
| visor recess depth (face → floor) | 0.22 |
| brow height (visor top → head top) | 0.25 |
| jaw height (shoulder line → visor bottom) | 0.25 |
| side frame width (each) | 0.175 |
| ear width | 0.19 |
| ear height | 0.24 |
| ear depth | 0.2 |
| ear inset from head corner | 0.085 |
| ear gap (inner edge to inner edge) | 0.45 |
| eye width = height | 0.135 |
| eye gap (inner edges) | 0.11 |
| eye centre height above visor bottom | 0.115 |
| eye depth (proud of visor floor) | 0.025 |
| arm width (upper / forearm / hand) | 0.2 |
| arm length (upper top → hand bottom) | 0.975 |
| arm outer edge from centre (hand) | 0.565 |
| arm hangs to (hand bottom height) | 0.7333 |
| leg width | 0.19 |
| leg separation (gap) | 0.14 |
| leg height (foot top → leg top) | 0.575 |
| leg depth | 0.225 |
| foot width | 0.275 |
| foot depth | 0.375 |
| foot height | 0.225 |
| foot forward offset | 0.0625 |
| tail segment 1 (w=h, depth) | 0.1625 |
| tail tip size | 0.1 |
| tail origin (x, y, z) from pivot | 0.0 |

Height split (of total 2.9025): head+ears 1.04 · torso 0.875 (+pelvis step 0.2125) · legs+feet 0.8.

## Joint pivots (×W, web axes x,y,z)

| joint | pivot |
|---|---|
| root | (0.0, 0.0, 0.0) |
| head | (0.0, 1.8625, 0.0) |
| armLeft | (-0.31, 1.8025, 0.0) |
| armRight | (0.31, 1.8025, 0.0) |
| legLeft | (-0.165, 0.8, 0.0) |
| legRight | (0.165, 0.8, 0.0) |
| tail | (0.2, 1.0, -0.2) |

## Every box (×W): centre (x,y,z) and size (w,h,d), grouped by joint

| box | joint | surface | centre | size |
|---|---|---|---|---|
| headBrow | head | ivory | (0.0, 2.5375, 0.0) | (1.0, 0.25, 0.725) |
| headJaw | head | ivory | (0.0, 1.9875, 0.0) | (1.0, 0.25, 0.725) |
| headStub | head | ivory | (0.0, 1.7875, 0.0) | (0.3, 0.15, 0.3) |
| headFrameLeft | head | ivory | (-0.4125, 2.2625, 0.0) | (0.175, 0.3, 0.725) |
| headFrameRight | head | ivory | (0.4125, 2.2625, 0.0) | (0.175, 0.3, 0.725) |
| headBack | head | ivory | (0.0, 2.2625, -0.11) | (0.65, 0.3, 0.505) |
| earLeft | head | ivory | (-0.32, 2.7825, -0.025) | (0.19, 0.24, 0.2) |
| earRight | head | ivory | (0.32, 2.7825, -0.025) | (0.19, 0.24, 0.2) |
| visorInterior | head | visor | (0.0, 2.2625, 0.155) | (0.65, 0.3, 0.025) |
| eyeLeft | head | eye | (-0.1225, 2.2275, 0.1825) | (0.135, 0.135, 0.025) |
| eyeRight | head | eye | (0.1225, 2.2275, 0.1825) | (0.135, 0.135, 0.025) |
| neck | root | ivory | (0.0, 1.8125, 0.0) | (0.325, 0.175, 0.325) |
| upperTorso | root | ivory | (0.0, 1.6687, 0.0) | (0.62, 0.3875, 0.45) |
| midTorso | root | ivory | (0.0, 1.325, 0.0) | (0.62, 0.3, 0.45) |
| lowerTorso | root | ivory | (0.0, 1.0813, 0.0) | (0.4875, 0.1875, 0.4) |
| pelvisStep | root | ivory | (0.0, 0.8813, 0.0) | (0.3625, 0.2125, 0.3375) |
| armLeftUpper | armLeft | ivory | (-0.44, 1.5083, 0.0) | (0.2, 0.4, 0.2125) |
| armLeftForearm | armLeft | ivory | (-0.4525, 1.1208, 0.0125) | (0.19, 0.375, 0.2) |
| armLeftHand | armLeft | ivory | (-0.4625, 0.8333, 0.025) | (0.205, 0.2, 0.225) |
| armRightUpper | armRight | ivory | (0.44, 1.5083, 0.0) | (0.2, 0.4, 0.2125) |
| armRightForearm | armRight | ivory | (0.4525, 1.1208, 0.0125) | (0.19, 0.375, 0.2) |
| armRightHand | armRight | ivory | (0.4625, 0.8333, 0.025) | (0.205, 0.2, 0.225) |
| legLeft | legLeft | ivory | (-0.165, 0.5125, 0.0) | (0.19, 0.575, 0.225) |
| legRight | legRight | ivory | (0.165, 0.5125, 0.0) | (0.19, 0.575, 0.225) |
| footLeft | legLeft | ivory | (-0.1775, 0.1125, 0.0625) | (0.275, 0.225, 0.375) |
| footRight | legRight | ivory | (0.1775, 0.1125, 0.0625) | (0.275, 0.225, 0.375) |
| tail01 | tail | ivory | (0.2875, 0.95, -0.2375) | (0.1625, 0.1625, 0.175) |
| tail02 | tail | ivory | (0.3875, 0.9875, -0.3375) | (0.1445, 0.1445, 0.157) |
| tail03 | tail | ivory | (0.4625, 1.075, -0.4) | (0.125, 0.125, 0.1375) |
| tail04 | tail | ivory | (0.5125, 1.1875, -0.4375) | (0.1125, 0.1125, 0.125) |
| tailTip | tail | ivory | (0.5375, 1.2875, -0.45) | (0.1, 0.1, 0.1125) |

## Materials (web canon)

| surface | colour | roughness | metalness | emissive |
|---|---|---|---|---|
| ivory body | #EBE5D6 | 0.72 | 0 | — |
| visor cavity | #050505 | 0.55 | 0 | — |
| eyes | #F2C94C | 0.40 | 0.1 | #C9A23A × 0.9 (restrained) |

## Rig contract (web)

Seven transform nodes, boxes merged per joint × surface INSIDE the joint's local space (no deformation, ever): root (position + yaw/roll), head (pitch/yaw), armLeft/armRight (pitch), legLeft/legRight (pitch), tail (pitch/yaw). Articulation is rigid-transform only.
