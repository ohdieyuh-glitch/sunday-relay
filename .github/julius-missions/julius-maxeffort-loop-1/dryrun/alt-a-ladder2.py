"""DRY-RUN ONLY: an ALTERNATIVE valid fix for defect A: the same shape as alt-a-mission-claim.py with a NARROWER top segment of the ladder:
`approved` and `reviewed` are trust shortfalls, `claimed_complete` is not. Must PASS the spec."""
import pathlib
import runpy
import sys

sys.argv = [sys.argv[0], "'reviewed', 'approved'"]
runpy.run_path(str(pathlib.Path(__file__).with_name('alt-a-mission-claim.py')), run_name='__main__')
