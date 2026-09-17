# CN01: the contact audit that found no defect (2026-09-17)

## What was asked
After WB01 (wall bases), WS01 (wall dressing) and GT01 (lawn edges), the remaining contact question was whether the
world's props actually stand ON the ground. This was measured, not eyeballed: every ground-standing prop in
city_props compared with the ground beneath it (street tiles, terrace platforms, garden lawns, the world slab).

## First number, and why it was wrong twice
- 5,380 props checked: **2,020 "floating"**, 86 sunken.
- Most of that is nonsense, and the meshes say so: SM_gate_arch_gold at a median 254 cm (it sits on gate piers),
  SM_gate_finial_ball at 126 (on posts), SM_waymarker_lamp at 242 (the lamp head on its column), SM_garden_urn at
  109 (on a pedestal). "Floating" here means "mounted on something", which is what those props are for.
- Narrowing to plants and excluding anything standing on another prop still left **698 plants 14-36 cm up** and 76
  hedges more than 60 cm under, median 1.5 m.

## Photographed before believing
`contact_closeups.jpg`, five close-ups of the worst cases (the first attempt, `first_poses_too_close.jpg`, put the
camera inside the geometry and proved nothing -- a reminder that a close-up needs distance ~3x the prop's radius and
a clear direction chosen away from buildings).

What the pictures show: **the plants are standing on things the ground model does not know about.** The floating
hedge mass sits on a raised terrace slab; the flowering shrubs and the hedge block sit in stone planters with their
edging clearly visible; the rose bushes stand on the lawn beside a stone bench. Not one of the five is in the air.

## Verdict
No defect. No pass. The 698 are a gap in my ground model -- it knows street tiles, terrace platforms, garden lawns and
the world slab, and nothing about raised beds, planter boxes and the tops of terraces -- not a gap in the world.

Worth keeping: a number this size, from a model this partial, is a hypothesis and not a finding. Five pictures cost
ten minutes and saved a pass that would have dropped 698 plants into the ground.
