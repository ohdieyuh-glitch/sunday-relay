#!/usr/bin/env python3
"""MQ07 -- the Clock Plaza's floor laid whole.

THE GAP (survey sv1, top-down cp0, 2026-09-15). GA02's round plaza about the fountain (r 10.5 m) was paved in
concentric courses that skipped a 1.5 m hole round each small generator planting; FL04 later stood flower beds in
those holes. On foot and from above it read as two ragged fans of loose slabs on a lawn -- the one unfinished floor on
the corridor after MQ02-MQ04.

WHAT CHANGES (three files, one pass):
  GA02   paves the courses whole round the fountain (no planters, no holes).
  FL04   sinks its beds inside the plaza round without replanting (NO_BEDS_CIRCLES).
  TRIM   (this file, reversible, exact befores from censuses 453 and 475) the plaza's two topiary balls, two rose
         bushes and the generator's four rose cone topiaries (plain actors).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "Districts"))
import courtkit as K  # noqa: E402

PASS = "MQ07"
CENSUS = HERE / "mq07_clock_plaza_census_2026-09-15.json"
TRIM = [
    ("WonderlandInstancedBatch_254", 31, "topiary ball in the plaza's paving ring (east)"),
    ("WonderlandInstancedBatch_254", 39, "topiary ball in the plaza's paving ring (west)"),
    ("WonderlandInstancedBatch_384", 2, "rose bush in the plaza's paving ring (east)"),
    ("WonderlandInstancedBatch_389", 2, "rose bush in the plaza's paving ring (west)"),
    ("StaticMeshActor_21", None, "rose cone topiary Court_Topiary0 cutting a 2 m hole in the paving ring"),
    ("StaticMeshActor_22", None, "rose cone topiary Court_Topiary1 inside the paving ring"),
    ("StaticMeshActor_23", None, "rose cone topiary Court_Topiary2 inside the paving ring"),
    ("StaticMeshActor_24", None, "rose cone topiary Court_Topiary3 inside the paving ring"),
]

if __name__ == "__main__":
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    trim = K.trim_spec(PASS, "Clock Plaza: loose topiary balls and rose bushes in the paving ring sunk (reversible)", rows, TRIM)
    K.write(HERE / "mq07_clock_plaza_floor_trim.json", trim)
    print("%s: %d trims" % (PASS, len(trim["trims"])))
