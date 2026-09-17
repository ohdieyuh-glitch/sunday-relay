# FD03 -- upper-storey windows: previewed, measured, NOT SAVED (2026-09-16)

Gap: 694 street-facing upper faces (3-19 m up) with no window at all (castle halls 457, facade panels 175, square
towers 59) -- the faces FD02 skips because they do not start at street level.

Repetition, addressed before the preview: 2,992 identical arched windows would be one tile. The forge gained an oculus
and a pair of pointed lancets (6729007f); facade_windows.py --upper now gives each face its body window by hash
(arched or lancet pair) and a round oculus on the top row of faces with 3+ rows or on single-column faces.
Mix: 1,369 arched, 1,368 lancet pairs, 255 oculi (a first mix put oculi on every 2-row face's top row -- 1,361, not
an accent). FD02's output was verified byte-identical after the change.

Visual (fd03_ab1.jpg, fd03_ab2.jpg): modest and controlled. Close up, tall castle walls gain paired Gothic lancets with a
frieze of oculi along the top band; South34 and FillW52 pick up upper-storey rhythm. At the wide city cameras
(WorldCam12, City_WorldWide56, SkylineRiseCam21) no visible change -- culled at 90 m, so no skyline noise.

Performance (perf_remove_ab.json; PIE, same session, the 184 FD03 batch actors destroyed; median frame ms):

| camera | R1 on | R1 off | R1 off again | R2 on | R2 off | R2 off again |
|---|---|---|---|---|---|---|
| City_FillNE48 | 85.7 | 87.9 | 75.2 | 76.2 | 69.6 | 76.9 |
| South_StreetHero34 | 132.6 | 96.6 | 76.4 | 88.1 | 74.9 | 74.6 |
| City_FillEE54 | 102.7 | 72.8 | 74.9 | 79.9 | 76.5 | 75.7 |
| WorldCam12 | 122.4 | 94.3 | 94.3 | 97.3 | 107.8 | 88.7 |

ON is higher in 7 of 8 cells; South34 +13 ms in round 2 on a ~75 ms frame (~17%), +36 ms in round 1. The job always
measures ON first in a PIE round, so warm-up inflates ON (round 1 especially) and the noise between the two OFF
windows is up to 20 ms. Not clearly acceptable for a modest visual gain.

Decision: NOT SAVED. All 17 layers removed from the editor (184 batch actors, 0 left) and the map saved in its
pre-FD03 state before closing the editor for the companion lane (reverted_and_closed.json).
Rework before a second attempt: only the first upper band (rise <= ~12 m, where a street camera actually sees it),
cull at ~50 m, and a measurement that alternates ON/OFF order across rounds so warm-up cannot favour either side.
