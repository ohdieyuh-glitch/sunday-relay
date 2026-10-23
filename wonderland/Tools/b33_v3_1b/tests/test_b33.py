"""test_b33.py v3 -- unit tests of the B33 tools (slicer, analysers, judge v3). DIAGNOSTIC tool, W2DEV, not evidence by itself.
Run: python -I -B tests/test_b33.py   (writes SYNTHETIC fixtures to tests/fixtures_out/ only)
Deliberate-FAIL fixtures per bar (air, landing, sinking), deliberate-INCONCLUSIVE fixtures, VOID fixtures, and one fixture per rule changed by the
M2 ruling a185b283 (B33 v3):
  B-2 registered FAIL + W2 PASS => FAIL                  test_B2_registered_fail_with_w2_pass_is_fail
  B-3 a bar FAIL under a timing backlog => FAIL           test_B3_bar_fail_under_a_backlog_is_fail (+ test_B3_gate_only_demotes_a_pass)
  B-4 no drive timeline => INCONCLUSIVE (M4 too)          test_B4_no_timeline_is_inconclusive (+ test_B4_unclassified_jump_stays_in_the_block)
  B-5 -wlframes on a command line => VOID                 test_B5_undisclosed_switch_voids
  B-6 pair with 5 falls in only one run => not PASS       test_B6_m4_needs_five_falls_in_both_runs
  B-7 M4 under the bars                                   test_B7_m4_is_judged_under_the_bars
  B-8 a sink 1.8 s after touchdown, before the next takeoff => FAIL     test_B8_sink_after_1_5_s_is_fail
  B-10 pair() with a CONTROL => REFUSED; --control-vs prints three conditions; control values from the observer log
       test_B10_pair_refuses_a_control, test_B10_control_vs_three_conditions, test_B10_control_values_confirmed_from_the_observer_log
  R4-11 M4 qualifies on min(median, last) - landing       test_R4_11_m4_start_z_is_min_of_median_and_last
  R4-12 speed-bound teleport; observer WLDEV => VOID       test_R4_12_speed_bound_teleport_voids, test_R4_12_observer_wldev_voids
  R4-13 exe sha256 not the candidate => VOID               test_R4_13_wrong_exe_voids
THE ONE PINNED CANDIDATE (tools/b33/CANDIDATE.json, read by the launcher and the judge; class Candidate):
  a PENDING marker VOIDs even when the exe matches       test_pending_marker_voids_even_with_the_right_exe
  an unreadable candidate file VOIDs (never a crash)     test_unreadable_candidate_file_voids_not_crashes
  READY: the file is the source of the expected exe      test_ready_candidate_is_the_source_of_the_expected_exe
  boot exe / commit / non-default candidate file => VOID test_ready_candidate_boot_commit_and_test_file_void
  the shipped file: not READY => every run VOID          test_shipped_candidate_file
  no other tool file holds the candidate hashes          test_no_other_tool_file_holds_the_candidate_hashes
THE PREREG ExecCmds SET (lead 10-20: -RenderCvars 'scalability 0'; class ExecCmdsPrereg): exactly {wl.Social.Dev <id> http://127.0.0.1:<port>,
  wl.Remote.LogPeriod 0.1, scalability 0} is accepted in any order; an extra wl.Remote.* / r.* (disclosed or not), a missing, repeated or
  changed command, an empty command (trailing comma), a non-loopback / other-identity / other-port dev command, or RUN.json render_cvars
  other than ["scalability 0"] => VOID.
v3.1 (M2b ruling fea3fb7f, review R7; class V31): one fixture per changed rule --
  R7-02 precedence text + a bar FAIL inside an INCOMPLETE block stays FAIL       test_R7_02_precedence_fail_beats_incomplete
  R7-03 -forcelogflush VOID even when RUN.json lists it; prereg_launch false VOID; --allow-* only with --historical
        test_R7_03_forcelogflush_voids_even_if_disclosed, test_R7_03_prereg_launch_false_voids, test_R7_03_allow_flags_need_historical
  R7-04 a control FAIL without a REGISTERED bar violation does not meet (a)       test_R7_04_control_needs_a_registered_bar_fail
  R7-05 the P7a record: APPROVED clears, REJECTED does not, a malformed record does not       test_R7_05_p7a_approval_rejection_invalid
  R7-06 console-set echoes: a CONTROL observer missing one -> VOID; an extra echo on a JUDGED client -> VOID     test_R7_06_echoes
  R7-07 pair / --control-vs refuse a JSON judged with an override                  test_R7_07_overrides_refused
  R7-08 a VOID run still shows its bars; the pair of a VOID run is VOID            test_R7_08_void_shows_the_bars
  R8-05 analog: a log changed after close -> VOID; a run never closed -> VOID       test_R8_05_close_hashes
  R7-09 the survey bounds: baseline = pinned v1; "whatever" no longer passes as "what"; route v2 inside the bounds
        test_R7_09_survey_bounds
SYNTHETIC runs are judged WITHOUT any override (R7-07): the judge's default candidate file is pointed (in-process) at a READY synthetic
candidate; tests that need the shipped CANDIDATE.json pass it explicitly.
and (when the b33a folder exists) B6: the registered analyser at shift 0 FAILS b33a on its drive blocks (22.50 / 2.86).
"""
import hashlib, io, json, os, shutil, sys, unittest, contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "b33_analyser"))
import b33_synth as S          # noqa: E402
import b33_judge as J          # noqa: E402
import b33_slicer as SL        # noqa: E402
import motion_diag as MD       # noqa: E402
import motion_diag_w2 as W     # noqa: E402

OUT = os.path.join(HERE, "fixtures_out")
B33A = r"C:\dev\iwonder\_qa_handoff\integration\r16reh16w_dev_20261019\r16_repair_loop\b33_runs\run_20261020T071219Z_b33a"
B33A_EXE = "F2476B479C2D4B6338E350AE16EB3F38826138605AA39F0D0EF352AC92835983"
SYNTH_EXE = "ab" * 32
_cache = {}
SHIPPED_CANDIDATE = J.CANDIDATE_FILE        # tools\\b33\\CANDIDATE.json (the copy's: the rehearsal harness)
os.makedirs(os.path.join(OUT, "candidates"), exist_ok=True)
SYNTH_CANDIDATE = os.path.join(OUT, "candidates", "synthetic_ready_default.json")
with open(SYNTH_CANDIDATE, "w", encoding="utf-8") as _f:
    json.dump({"status": "READY", "label": "synthetic-default", "commit": "synthetic", "game_exe_sha256": SYNTH_EXE,
               "boot_exe_sha256": "cd" * 32, "package_folder": "X:/synth/pkg"}, _f, indent=1)
J.CANDIDATE_FILE = SYNTH_CANDIDATE          # synthetic runs judged with NO override (R7-07)
SHIPPED_RELAY_PIN, SHIPPED_ROUTE_PIN = J.RELAY_PIN_FILE, J.ROUTE_PIN_FILE   # v3.1: the shipped PENDING slots (class Pins)
SYNTH_RELAY_PIN = os.path.join(OUT, "candidates", "synthetic_relay_pin.json")
with open(SYNTH_RELAY_PIN, "w", encoding="utf-8") as _f:
    json.dump({"status": "PINNED", "label": "synthetic", "commit": "cbe584becf417c48cc4de8efe8a2fa16f404c0bf",
               "tree": "490a543282a3703ce6878e0586dbe9a2a524d107"}, _f, indent=1)
SYNTH_ROUTE_PIN = os.path.join(OUT, "candidates", "synthetic_route_pin.json")
with open(SYNTH_ROUTE_PIN, "w", encoding="utf-8") as _f:
    json.dump({"status": "PINNED", "route": "drive_synth/route.json",
               "route_sha256": hashlib.sha256(S.SYNTH_ROUTE_TEXT.encode("utf-8")).hexdigest()}, _f, indent=1)
J.RELAY_PIN_FILE, J.ROUTE_PIN_FILE = SYNTH_RELAY_PIN, SYNTH_ROUTE_PIN   # synthetic runs judged against pinned synthetic slots


def run(name, **kw):
    """build (once) a synthetic run folder and judge it with NO override unless the test passes judge_args (None values are dropped)"""
    key = (name, json.dumps(kw, sort_keys=True, default=str))
    if key in _cache:
        return _cache[key]
    d = os.path.join(OUT, name)
    if os.path.exists(d):
        shutil.rmtree(d)
    judge_args = {k: x for k, x in kw.pop("judge_args", {}).items() if x is not None}
    mutate = kw.pop("mutate", None)
    S.build(d, **kw)
    if mutate:
        mutate(d)
    rep = J.judge_run(d, judge_args)
    with open(os.path.join(d, "JUDGE.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1, default=str)
    with open(os.path.join(d, "JUDGE.txt"), "w", encoding="utf-8") as f:
        f.write(J.fmt(rep))
    _cache[key] = rep
    return rep


def jpath(name):
    return os.path.join(OUT, name, "JUDGE.json")


def v(rep, scn):
    return rep["scenarios"][scn]["verdict"]


OLD = ["wl.Remote.InterpEaseZ 30", "wl.Remote.ReportTimeSamples 0", "wl.Remote.RttClock 0"]
BASE_OBS = ["wl.Social.Dev synth_v http://127.0.0.1:8796", "wl.Remote.LogPeriod 0.1", "scalability 0"]   # the PREREG B33 v3 ExecCmds set
BASE_SND = ["wl.Social.Dev synth_s http://127.0.0.1:8796", "wl.Remote.LogPeriod 0.1", "scalability 0"]
SYNTH_BOOT = "cd" * 32


def cand_file(name, **kw):
    """a test candidate file (fixtures_out/candidates/<name>.json); defaults = READY and matching the synthetic run"""
    c = {"status": "READY", "label": "synthetic-candidate", "commit": "synthetic", "game_exe_sha256": SYNTH_EXE, "boot_exe_sha256": SYNTH_BOOT,
         "package_folder": "X:/synth/pkg"}
    c.update(kw)
    d = os.path.join(OUT, "candidates")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(c, f, indent=1)
    return p
CONTROL = dict(role="CONTROL", exec_observer=BASE_OBS + OLD, standing_reps=False)   # a control observer: old values, no standing samples


class Registered(unittest.TestCase):
    def test_copy_is_byte_identical(self):
        with open(os.path.join(ROOT, "b33_analyser", "motion_diag.py"), "rb") as f:
            h = hashlib.sha256(f.read()).hexdigest()
        self.assertEqual(h, J.REGISTERED_SHA256)

    def test_w2_refuses_a_shift(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = W.main(["--shift-ms", "-50", "a", "b"])
        self.assertEqual(rc, 2)
        self.assertIn("fixed at 0 ms", buf.getvalue())

    def test_v3_refuses_the_removed_options(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(J.main(["x", "--verdict-analyser", "w2"]), 2)
            self.assertEqual(J.main(["x", "--m4-bars", "report"]), 2)


class Slicer(unittest.TestCase):
    def test_classes_falls_no_teleport(self):
        rep = run("perfect")
        c = rep["slicer"]["counts"]
        self.assertEqual((c["STANDING"], c["WALKING"], c["RUNNING"]), (8, 8, 8))
        self.assertEqual(rep["slicer"]["unclassified"], 0)
        falls = rep["scenarios"]["M4"]["falls_listed"]
        self.assertEqual(len(falls), J.M4_ATTEMPTS)      # Q-M2c-5: the default synthetic run makes the pre-stated 10 attempts
        for f in falls:
            self.assertTrue(f["in_m4_block"])
            self.assertAlmostEqual(f["drop"], 111.3, delta=0.15)
            self.assertTrue(f["qualifies"])
        self.assertEqual(rep["teleports"], [])

    def test_blocked_hop_and_mixed_jump_unclassified(self):
        sends = [{"motion": m, "z": z, "t": i * 0.13, "hspeed": hs, "x": 0.0, "y": 0.0, "stamp": 0.0, "i": i}
                 for i, (m, z, hs) in enumerate([("IDLE", 10, 0), ("JUMP", 10.4, 0), ("IDLE", 10, 0), ("IDLE", 10, 0),
                                                 ("JUMP", 50, 100), ("JUMP", 90, 100), ("FALL", 50, 100), ("WALK", 10, 100)])]
        d1 = SL.classify_run(sends, 1, 1)
        d2 = SL.classify_run(sends, 4, 6)
        self.assertEqual(d1["class"], "UNCLASSIFIED")
        self.assertIn("blocked hop", d1["reason"])
        self.assertEqual(d2["class"], "UNCLASSIFIED")
        self.assertIn("fits no class", d2["reason"])

    def test_R4_11_m4_start_z_is_min_of_median_and_last(self):
        # median of the lip samples 101.0 (qualifies: 101.0 - 0.6 = 100.4), but the last ground sample is 100.3 (100.3 - 0.6 = 99.7): NOT qualifying
        zs = [101.6, 101.4, 101.0, 100.8, 100.3]
        sends = [{"motion": "IDLE", "z": z, "t": i * 0.13, "x": 0.0, "y": 0.0, "stamp": 0.0, "i": i, "k": i} for i, z in enumerate(zs)]
        sends += [{"motion": "FALL", "z": 50.0, "t": 0.70, "x": 0, "y": 0, "stamp": 0, "i": 5, "k": 5},
                  {"motion": "IDLE", "z": 0.6, "t": 0.85, "x": 0, "y": 0, "stamp": 0, "i": 6, "k": 6}]
        d = {"k0": 5, "k1": 5, "z_land": 0.6}
        f = SL.m4_fall(sends, d)
        self.assertAlmostEqual(f["drop_median"], 100.4, places=6)
        self.assertAlmostEqual(f["drop_last"], 99.7, places=6)
        self.assertAlmostEqual(f["drop"], 99.7, places=6)
        self.assertFalse(f["qualifies"])


class Judge(unittest.TestCase):
    def test_perfect_passes(self):
        rep = run("perfect")
        for scn in ("STANDING", "WALKING", "RUNNING", "M4"):
            self.assertEqual(v(rep, scn), "PASS", (scn, rep["scenarios"][scn].get("why")))
            self.assertLess(rep["scenarios"][scn]["registered"]["air_p95_abs"], 0.5)
        self.assertEqual(rep["result"], "PASS")
        self.assertGreater(rep["report_time_samples_check"]["repeated_rep_lines"], 0)

    def test_deliberate_fail_air(self):
        rep = run("fail_air", air_off=12.0)
        for scn in ("STANDING", "WALKING", "RUNNING"):
            self.assertEqual(v(rep, scn), "FAIL")
            self.assertTrue(any(w.startswith("registered: air p95") for w in rep["scenarios"][scn]["why"]))
        self.assertEqual(rep["result"], "FAIL")

    def test_air_just_inside_the_bar_passes(self):
        self.assertEqual(v(run("air_9", air_off=9.0), "STANDING"), "PASS")

    def test_deliberate_fail_landing(self):
        rep = run("fail_land", land_off=3.0)
        for scn in ("STANDING", "WALKING", "RUNNING"):
            self.assertEqual(v(rep, scn), "FAIL")
            self.assertTrue(any(w.startswith("registered: landing p95") for w in rep["scenarios"][scn]["why"]))

    def test_deliberate_fail_sinking(self):
        rep = run("fail_sink", sink=-3.0)
        self.assertEqual(v(rep, "STANDING"), "FAIL")
        self.assertTrue(any("registered: sinking" in w for w in rep["scenarios"]["STANDING"]["why"]))
        self.assertEqual(rep["result"], "FAIL")

    def test_sink_inside_tolerance_passes(self):
        self.assertEqual(v(run("sink_1_9", sink=-1.9), "STANDING"), "PASS")

    def test_deliberate_inconclusive_counts(self):
        rep = run("inconclusive_5_standing", plan=S.default_plan(n_stand=5))
        self.assertEqual(v(rep, "STANDING"), "INCONCLUSIVE")
        self.assertTrue(any("counted STANDING jumps 5 < 7" in w for w in rep["scenarios"]["STANDING"]["why"]))
        self.assertEqual(v(rep, "WALKING"), "PASS")
        self.assertEqual(rep["result"], "INCONCLUSIVE")

    def test_fail_beats_short_count(self):
        self.assertEqual(v(run("fail_air_5", plan=S.default_plan(n_stand=5), air_off=12.0), "STANDING"), "FAIL")

    def test_void_on_wldev_line(self):
        rep = run("void_wldev", dev_line=True)
        self.assertEqual(rep["result"], "VOID")
        self.assertEqual(len(rep["void_lines_sender"]), 1)

    def test_void_on_teleport(self):
        rep = run("void_teleport", teleport=True)
        self.assertEqual(rep["result"], "VOID")
        self.assertGreaterEqual(len(rep["teleports"]), 1)

    def test_m4_fall_below_100_listed_and_excluded(self):
        rep = run("m4_999", plan=S.default_plan(m4_drops=(111.3, 111.3, 99.9, 111.3, 111.3)))
        m4 = rep["scenarios"]["M4"]
        self.assertEqual(m4["qualifying"], 4)
        low = [f for f in m4["falls_listed"] if not f["qualifies"]]
        self.assertEqual(len(low), 1)
        self.assertAlmostEqual(low[0]["drop"], 99.9, delta=0.15)
        self.assertIn("excluded by the 100.0 rule only", low[0]["note"])
        self.assertEqual(m4["verdict"], "INCONCLUSIVE")

    def test_m4_space_press_inconclusive(self):
        rep = run("m4_space", m4_space_at=0.5)
        self.assertEqual(rep["scenarios"]["M4"]["verdict"], "INCONCLUSIVE")
        self.assertTrue(any("Space" in w for w in rep["scenarios"]["M4"]["why"]))

    def test_frames_required(self):
        rep = run("no_frames", frames=False)
        self.assertEqual(v(rep, "STANDING"), "INCONCLUSIVE")
        self.assertTrue(any("no observer frame" in w for w in rep["scenarios"]["STANDING"]["why"]))
        self.assertEqual(v(run("no_frames_ok", frames=False, judge_args={"--no-require-frames": True}), "STANDING"), "PASS")

    def test_steady_log_load(self):
        # 9 ms per line + 40 filler lines/s: the queue builds and drains. The registered analyser carries the stamp noise; W2 removes it.
        # v3.1 Q-M2c-5: 8 ms per line (was 9): with 10 M4 attempts (twice the samples) the REGISTERED sinking test read -2.03 under 9 ms
        rep = run("load_steady", sender_cost=0.008, viewer_cost=0.008, filler_sender_hz=40.0, filler_viewer_hz=40.0)
        for scn in ("STANDING", "WALKING", "RUNNING", "M4"):
            st = rep["scenarios"][scn]
            self.assertEqual(st["verdict"], "PASS", st.get("why"))
            self.assertLess(st["w2"]["air_p95_abs"], 1.0)
            self.assertGreater(st["registered"]["air_p95_abs"], 2.0)

    # ---------------- the M2 ruling a185b283 rules (B33 v3) ----------------
    def test_B2_registered_fail_with_w2_pass_is_fail(self):
        # a 20 ms per line viewer queue: the REGISTERED analyser (raw stamps) measures ~16 uu, W2 ~0.04: the registered bar decides -> FAIL
        rep = run("B2_reg_fail_w2_pass", viewer_cost=0.020, filler_viewer_hz=5.0)
        st = rep["scenarios"]["STANDING"]
        self.assertGreater(st["registered"]["air_p95_abs"], 10.0)
        self.assertLess(st["w2"]["air_p95_abs"], 1.0)
        self.assertEqual(st["w2_bar_violations"], [])
        self.assertEqual(st["verdict"], "FAIL")
        self.assertEqual(rep["result"], "FAIL")

    def test_B3_bar_fail_under_a_backlog_is_fail(self):
        # air +12 uu while the viewer's log never drains (the reviewer's R4-03 fixture): FAIL, never INCONCLUSIVE
        rep = run("B3_air12_backlog", air_off=12.0, viewer_cost=0.010, filler_viewer_hz=120.0)
        for scn in ("STANDING", "WALKING", "RUNNING"):
            self.assertEqual(v(rep, scn), "FAIL", rep["scenarios"][scn]["why"])
        self.assertEqual(rep["result"], "FAIL")
        # and a perfect observer under the same backlog: the raw stamps violate the registered bar -> FAIL too (B-3: no gate turns a FAIL)
        rep2 = run("B3_perfect_backlog", viewer_cost=0.010, filler_viewer_hz=120.0)
        self.assertEqual(v(rep2, "STANDING"), "FAIL")

    def test_B3_gate_only_demotes_a_pass(self):
        # a 12 ms per line viewer queue: both analysers meet the bars on STANDING (registered ~9.5 uu), but the raw viewer file lag p95 is
        # over 25 ms, so the registered stamps are not trusted for a PASS: the PASS is demoted to INCONCLUSIVE (a gate never makes a FAIL)
        rep = run("B3_gate_demotes", viewer_cost=0.012, filler_viewer_hz=25.0)
        st = rep["scenarios"]["STANDING"]
        self.assertEqual(st["registered_bar_violations"] + st["w2_bar_violations"], [])
        self.assertEqual(st["verdict"], "INCONCLUSIVE")
        self.assertTrue(all(w.startswith("timing") for w in st["why"]), st["why"])

    def test_B4_no_timeline_is_inconclusive(self):
        rep = run("B4_no_timeline", timeline=False)
        for scn in ("STANDING", "WALKING", "RUNNING", "M4"):
            self.assertEqual(v(rep, scn), "INCONCLUSIVE")
            self.assertTrue(any("no drive timeline" in w for w in rep["scenarios"][scn]["why"]))
        self.assertEqual(rep["result"], "INCONCLUSIVE")

    def test_B4_unclassified_jump_stays_in_the_block(self):
        # a 12 uu air error on the standing block's samples is FAILed whether or not the slicer counts those jumps: the block is the scenario
        rep = run("B4_block_fail", air_off=12.0)
        st = rep["scenarios"]["STANDING"]
        self.assertEqual(st["blocks"], 1)
        self.assertEqual(st["verdict"], "FAIL")

    def test_B5_undisclosed_switch_voids(self):
        rep = run("B5_wlframes", extra_switches=("-wlframes",))
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("-wlframes" in w for w in rep["result_why"]), rep["result_why"])

    def test_B7_m4_is_judged_under_the_bars(self):
        rep = run("fail_air", air_off=12.0)
        self.assertEqual(rep["scenarios"]["M4"]["verdict"], "FAIL")

    def test_B8_sink_after_1_5_s_is_fail(self):
        # standing jumps 3.2 s apart (2.34 s on the ground); a -3 uu sink 1.7-1.95 s after touchdown, before the next takeoff: FAIL (no 1.5 s cap)
        rep = run("B8_late_sink", plan=S.default_plan(stand_gap=3.2), sink=-3.0, sink_from=1.7, sink_to=1.95)
        st = rep["scenarios"]["STANDING"]
        self.assertEqual(st["verdict"], "FAIL", st["why"])
        self.assertTrue(any("sinking" in w for w in st["why"]))

    def test_R4_12_speed_bound_teleport_voids(self):
        rep = run("R4_12_tp200", teleport=True, teleport_uu=200.0)
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any(t["rule"] == "speed" for t in rep["teleports"]), rep["teleports"])

    def test_R4_12_observer_wldev_voids(self):
        rep = run("R4_12_obs_wldev", dev_line_observer=True)
        self.assertEqual(rep["result"], "VOID")
        self.assertEqual(len(rep["void_lines_observer"]), 1)

    def test_R4_13_wrong_exe_voids(self):
        # a READY candidate whose game exe is another one: the run's exe is VOID (no --expect-exe: the candidate file is the source)
        rep = run("R4_13_wrong_exe", judge_args={"--expect-exe": None, "--candidate-file": cand_file("other_exe", game_exe_sha256="ef" * 32)})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("not the expected candidate" in w for w in rep["result_why"]), rep["result_why"])


class Candidate(unittest.TestCase):
    """THE ONE pinned candidate: tools/b33/CANDIDATE.json (lead 10-20: z pending; launcher refuses, judge VOIDs)"""
    def test_pending_marker_voids_even_with_the_right_exe(self):
        p = cand_file("pending", status="PENDING z")   # every other field matches the synthetic run
        rep = run("cand_pending", judge_args={"--expect-exe": None, "--candidate-file": p})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("not READY" in w for w in rep["result_why"]), rep["result_why"])
        self.assertFalse(any("not the expected candidate" in w for w in rep["result_why"]), rep["result_why"])

    def test_unreadable_candidate_file_voids_not_crashes(self):
        p = os.path.join(OUT, "candidates", "broken.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write('{"status": "READY", "what": "an unescaped "quote" breaks it"}')
        rep = run("cand_broken", judge_args={"--expect-exe": None, "--candidate-file": p})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("not READY" in w and "INVALID" in w for w in rep["result_why"]), rep["result_why"])

    def test_ready_candidate_is_the_source_of_the_expected_exe(self):
        rep = run("cand_ready", judge_args={"--expect-exe": None, "--candidate-file": cand_file("ready")})
        self.assertEqual(rep["result"], "PASS", rep.get("result_why"))
        self.assertEqual(rep["expected_exe"], SYNTH_EXE)
        self.assertEqual(rep["candidate"]["status"], "READY")
        self.assertIsNone(rep["candidate"]["expect_exe_override"])

    def test_ready_candidate_boot_commit_and_test_file_void(self):
        r1 = run("cand_boot", judge_args={"--expect-exe": None, "--candidate-file": cand_file("boot", boot_exe_sha256="ee" * 32)})
        self.assertEqual(r1["result"], "VOID")
        self.assertTrue(any("boot exe sha256" in w for w in r1["result_why"]), r1["result_why"])
        r2 = run("cand_commit", judge_args={"--expect-exe": None, "--candidate-file": cand_file("commit", commit="383f720c04533b301faf42174860cd3ba06de137")})
        self.assertEqual(r2["result"], "VOID")
        self.assertTrue(any("RUN.json commit" in w for w in r2["result_why"]), r2["result_why"])
        r3 = run("cand_testfile", run_extra={"candidate": {"file": "X:/tests/c.json", "default": False}},
                 judge_args={"--expect-exe": None, "--candidate-file": cand_file("ready2")})
        self.assertEqual(r3["result"], "VOID")
        self.assertTrue(any("non-default candidate file" in w for w in r3["result_why"]), r3["result_why"])

    def test_shipped_candidate_file(self):
        self.assertEqual(SHIPPED_CANDIDATE, os.path.join(ROOT, "CANDIDATE.json"))
        c = J.load_candidate(SHIPPED_CANDIDATE)
        for k in ("status", "label", "commit", "game_exe_sha256", "boot_exe_sha256", "package_folder"):
            self.assertIn(k, c)
        rep = run("cand_shipped", judge_args={"--candidate-file": SHIPPED_CANDIDATE})
        self.assertEqual(rep["result"], "VOID")                      # the synthetic exe is never the candidate
        self.assertEqual(rep["candidate"]["file"], SHIPPED_CANDIDATE)
        if c["status"] != "READY":                                    # as shipped: "PENDING z" => every run VOID
            self.assertTrue(any("not READY" in w for w in rep["result_why"]), rep["result_why"])

    def test_no_other_tool_file_holds_the_candidate_hashes(self):
        c = J.load_candidate(SHIPPED_CANDIDATE)
        hashes = [h.lower() for h in (c.get("game_exe_sha256"), c.get("boot_exe_sha256")) if h and len(h) == 64]
        skip = {"fixtures_out", "dryrun_out", "launch_fixture", "stop_fixture", "survey_fixture", "__pycache__"}
        hits = []
        for dp, dn, fn in os.walk(ROOT):
            dn[:] = [d for d in dn if d not in skip]
            for f in fn:
                if f.endswith((".py", ".ps1", ".cs")):
                    with open(os.path.join(dp, f), encoding="utf-8", errors="replace") as fh:
                        t = fh.read().lower()
                    hits += [(f, h[:8]) for h in hashes if h in t]
        self.assertEqual(hits, [], "a candidate hash outside CANDIDATE.json")


class ExecCmdsPrereg(unittest.TestCase):
    """lead 10-20: the prereg judged launch is -RenderCvars 'scalability 0': the judge accepts exactly that ExecCmds set and VOIDs any other"""
    def test_exact_prereg_set_accepted_in_any_order(self):
        rep = run("exec_prereg", exec_sender=BASE_SND, exec_observer=BASE_OBS)
        self.assertEqual(rep["result"], "PASS", rep.get("result_why"))
        self.assertTrue(rep["exec_cmds_prereg"]["checked"])
        rep2 = run("exec_prereg_shuffled", exec_sender=list(reversed(BASE_SND)), exec_observer=[BASE_OBS[2], BASE_OBS[0], BASE_OBS[1]])
        self.assertEqual(rep2["result"], "PASS", rep2.get("result_why"))

    def test_any_other_execcmds_set_voids(self):
        cases = {
            "extra_wl_remote": (dict(exec_observer=BASE_OBS + ["wl.Remote.RttClock 1"]), "not allowed"),
            "extra_r_undisclosed": (dict(exec_sender=BASE_SND + ["r.ScreenPercentage 50"]), "not allowed"),
            "extra_r_disclosed": (dict(exec_sender=BASE_SND + ["r.ScreenPercentage 50"], exec_observer=BASE_OBS + ["r.ScreenPercentage 50"],
                                       render_cvars=("scalability 0", "r.ScreenPercentage 50")), "not exactly the prereg"),
            "missing_scalability": (dict(exec_observer=BASE_OBS[:2]), "rendering commands []"),
            "repeated_scalability": (dict(exec_sender=BASE_SND + ["scalability 0"]), "rendering commands"),
            "other_log_period": (dict(exec_sender=[BASE_SND[0], "wl.Remote.LogPeriod 0.2", BASE_SND[2]]), "logging command"),
            "not_loopback": (dict(exec_sender=["wl.Social.Dev synth_s http://10.0.0.5:8796"] + BASE_SND[1:]), "not allowed"),
            "other_identity": (dict(exec_sender=["wl.Social.Dev someone http://127.0.0.1:8796"] + BASE_SND[1:]), "dev identity"),
            "other_port": (dict(exec_observer=["wl.Social.Dev synth_v http://127.0.0.1:8797"] + BASE_OBS[1:]), "server port"),
            "not_disclosed_in_run_json": (dict(render_cvars=()), "disclosed.render_cvars"),
            "trailing_comma": (dict(exec_observer=BASE_OBS + [""]), "empty command"),
        }
        for name, (kw, why) in cases.items():
            rep = run("exec_void_" + name, **kw)
            self.assertEqual(rep["result"], "VOID", name)
            self.assertTrue(any(why in w for w in rep["result_why"]), (name, rep["result_why"]))


class LaunchSettings(unittest.TestCase):
    def test_gameplay_cvar_voids_a_judged_run(self):
        rep = run("void_easez_judged", exec_observer=BASE_OBS + ["wl.Remote.InterpEaseZ 120"])
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("not allowed" in w for w in rep["result_why"]), rep["result_why"])

    def test_old_values_on_a_judged_run_void(self):
        rep = run("void_old_on_judged", exec_observer=BASE_OBS + OLD)
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("JUDGED run" in w for w in rep["result_why"]))

    def test_undisclosed_render_cvar_voids_disclosed_does_not(self):
        self.assertEqual(run("void_render_undisclosed", render_cvars=())["result"], "VOID")   # scalability 0 in the logs, not in RUN.json
        rep2 = run("render_disclosed", render_cvars=("scalability 0",))
        self.assertEqual(rep2["result"], "PASS", rep2.get("result_why"))

    def test_not_prereg_server_voids(self):
        rep = run("void_not_prereg_server", server={"prereg": False, "kind": "NOT-PREREG OVERRIDE: -ServerTree", "tree_dir": "X:/other"})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("NOT-PREREG server" in w for w in rep["result_why"]), rep["result_why"])

    def test_missing_command_line_is_inconclusive(self):
        rep = run("no_cmdline", cmdline=False)
        self.assertEqual(rep["result"], "INCONCLUSIVE")
        self.assertTrue(any("Command Line" in w for w in rep["result_why"]))

    def test_control_must_carry_exactly_the_old_values_on_the_observer(self):
        rep = run("control_misconfigured", role="CONTROL", exec_observer=BASE_OBS + OLD[:2], standing_reps=False)
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("CONTROL misconfigured" in w for w in rep["result_why"]))
        rep2 = run("control_on_sender", exec_sender=BASE_SND + OLD, **CONTROL)
        self.assertEqual(rep2["result"], "VOID")

    def test_B10_control_values_confirmed_from_the_observer_log(self):
        # a CONTROL whose observer log still shows newer-standing-report samples (ReportTimeSamples 1 in effect) is VOID ...
        rep = run("B10_control_rts_in_effect", role="CONTROL", exec_observer=BASE_OBS + OLD, standing_reps=True)
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("CONTROL values not in effect" in w for w in rep["result_why"]), rep["result_why"])
        # ... and a JUDGED run whose observer shows none (the compiled default 1 not in effect) is VOID
        rep2 = run("B10_judged_rts_missing", standing_reps=False)
        self.assertEqual(rep2["result"], "VOID")
        self.assertTrue(any("ReportTimeSamples 1 is not in effect" in w for w in rep2["result_why"]), rep2["result_why"])


class Pair(unittest.TestCase):
    def test_pair_rules(self):
        for root, other, kw in (("pr_ab", "pair_b", dict(pids=(21, 22))), ("pr_ac", "pair_c_samepids", dict(pids=(11, 12))),
                                ("pr_af", "pair_f_fail", dict(pids=(31, 32), air_off=12.0))):
            run(root + "/pair_a", pids=(11, 12))
            run(root + "/" + other, **kw)
        self.assertEqual(J.pair(jpath("pr_ab/pair_a"), jpath("pr_ab/pair_b"))[1], "PASS")
        self.assertEqual(J.pair(jpath("pr_ac/pair_a"), jpath("pr_ac/pair_c_samepids"))[1], "INCONCLUSIVE")   # shared pids: not two fresh runs
        self.assertEqual(J.pair(jpath("pr_af/pair_a"), jpath("pr_af/pair_f_fail"))[1], "FAIL")

    def test_B6_m4_needs_five_falls_in_both_runs(self):
        run("pr_b6/pair_a", pids=(11, 12))
        run("pr_b6/B6_four_falls", pids=(71, 72), plan=S.default_plan(m4_drops=(111.3, 111.3, 99.9, 111.3, 111.3) + (99.0,) * 5))
        text, result = J.pair(jpath("pr_b6/pair_a"), jpath("pr_b6/B6_four_falls"))
        self.assertNotEqual(result, "PASS", text)
        self.assertIn("M4: run1 PASS, run2 INCONCLUSIVE -> INCONCLUSIVE", text)

    def test_B10_pair_refuses_a_control(self):
        run("pair_a", pids=(11, 12))
        run("B10_control_fail", pids=(81, 82), air_off=15.0, **CONTROL)
        text, result = J.pair(jpath("pair_a"), jpath("B10_control_fail"))
        self.assertEqual(result, "REFUSED", text)
        self.assertIn("a CONTROL run is never paired", text)

    def test_B10_control_vs_three_conditions(self):
        run("B10_control_fail", pids=(81, 82), air_off=15.0, **CONTROL)
        run("B10_control_pass", pids=(83, 84), **CONTROL)
        run("pair_a", pids=(11, 12))
        run("pair_b", pids=(21, 22))
        p7a = os.path.join(OUT, "P7A_NOTE_SYNTHETIC.txt")
        with open(p7a, "w", encoding="utf-8") as f:
            f.write("DECISION: APPROVED\nVERBATIM: SYNTHETIC test record standing in for the founder's P7a look; never real\n")
        self.assertEqual(_rep("B10_control_fail")["result"], "FAIL")
        text, rc = J.control_vs(jpath("B10_control_fail"), [jpath("pair_a"), jpath("pair_b")], p7a)
        self.assertEqual(rc, 0, text)
        for k in ("CONDITION (a)", "CONDITION (b)", "CONDITION (c)"):
            self.assertIn(k, text)
        self.assertIn("ALL THREE CONDITIONS MET", text)
        text, rc = J.control_vs(jpath("B10_control_fail"), [jpath("pair_a"), jpath("pair_b")], None)      # no P7a note
        self.assertNotEqual(rc, 0)
        self.assertIn("NOT RECORDED (--p7a <record>)", text)
        text, rc = J.control_vs(jpath("B10_control_fail"), [jpath("pair_a")], p7a)                          # one judged run only
        self.assertNotEqual(rc, 0)
        self.assertIn("CONDITION (b)", text)
        text, rc = J.control_vs(jpath("B10_control_pass"), [jpath("pair_a"), jpath("pair_b")], p7a)         # the control did not fail
        self.assertNotEqual(rc, 0)
        self.assertIn("instrument cannot tell the change apart", text)
        text, rc = J.control_vs(jpath("pair_a"), [jpath("pair_b")], p7a)
        self.assertIn("NOT COMPARABLE", text)


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


class V31(unittest.TestCase):
    """B33 v3.1: one fixture per rule changed by the M2b ruling fea3fb7f (review R7)"""
    def test_R7_02_precedence_fail_beats_incomplete(self):
        self.assertIn("PRECEDENCE (R7-02): VOID > FAIL > INCONCLUSIVE (an INCOMPLETE block included) > timing gate > PASS", J.ALGEBRA)

        def drop_stand_end(d):           # the STAND block never ends (an abort): INCOMPLETE; then re-close like b33_stop.ps1
            tl = os.path.join(d, "drive_synth", "timeline.csv")
            with open(tl, encoding="utf-8") as f:
                rows = [r for r in f.read().splitlines() if not r.endswith(",BLOCK_END,STAND")]
            write(tl, "\n".join(rows) + "\n")
            S.close_run(d)
        rep = run("R7_02_incomplete_air12", air_off=12.0, mutate=drop_stand_end)
        self.assertEqual(v(rep, "STANDING"), "FAIL", rep["scenarios"]["STANDING"].get("why"))
        self.assertTrue(any(b["name"] == "STAND" and not b["complete"] for b in rep["blocks"]), rep["blocks"])   # the block IS incomplete
        rep2 = run("R7_02_incomplete_clean", mutate=drop_stand_end)
        self.assertEqual(v(rep2, "STANDING"), "INCONCLUSIVE")

    def test_R7_03_forcelogflush_voids_even_if_disclosed(self):
        sw = list(J.DEFAULT_SWITCHES) + ["-forcelogflush"]
        rep = run("R7_03_forcelogflush", extra_switches=("-forcelogflush",),
                  run_extra={"disclosed": {"render_cvars": ["scalability 0"], "logging_cvars": ["wl.Remote.LogPeriod 0.1"], "launch_switches": sw}})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("-forcelogflush" in w and "PREREG list" in w for w in rep["result_why"]), rep["result_why"])

    def test_R7_03_prereg_launch_false_voids(self):
        rep = run("R7_03_prereg_launch_false", run_extra={"prereg_launch": False})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("prereg_launch" in w for w in rep["result_why"]), rep["result_why"])

    def test_R7_03_allow_flags_need_historical(self):
        for flag, val in (("--allow-switches", "-forcelogflush"), ("--allow-launch-cmds", "r.ScreenPercentage 50")):
            with self.assertRaises(SystemExit) as cm:
                run("R7_03_allow_" + flag.strip("-"), judge_args={flag: val})
            self.assertIn("--historical", str(cm.exception))

    def test_R7_04_control_needs_a_registered_bar_fail(self):
        run("B10_control_fail", pids=(81, 82), air_off=15.0, **CONTROL)
        run("pair_a", pids=(11, 12))
        run("pair_b", pids=(21, 22))
        p7a = write(os.path.join(OUT, "P7A_APPROVED.txt"), "DECISION: APPROVED\nVERBATIM: SYNTHETIC approval\n")
        with open(jpath("B10_control_fail"), encoding="utf-8") as f:
            c = json.load(f)
        self.assertTrue(c["scenarios"]["STANDING"]["registered_bar_violations"])
        for scn in c["scenarios"].values():          # the same FAIL verdicts, but no registered bar violation (W2-only)
            if "registered_bar_violations" in scn:
                scn["registered_bar_violations"] = []
        w2only = write(os.path.join(OUT, "R7_04_control_w2only.json"), json.dumps(c))
        text, rc = J.control_vs(w2only, [jpath("pair_a"), jpath("pair_b")], p7a)
        self.assertNotEqual(rc, 0, text)
        self.assertIn("CONDITION (a) the control (result FAIL) FAILs >= 1 jump scenario by a REGISTERED bar at shift 0: NOT MET", text)
        self.assertIn("not counted, R7-04", text)
        text, rc = J.control_vs(jpath("B10_control_fail"), [jpath("pair_a"), jpath("pair_b")], p7a)
        self.assertEqual(rc, 0, text)

    def test_R7_05_p7a_approval_rejection_invalid(self):
        run("B10_control_fail", pids=(81, 82), air_off=15.0, **CONTROL)
        run("pair_a", pids=(11, 12))
        run("pair_b", pids=(21, 22))
        args = (jpath("B10_control_fail"), [jpath("pair_a"), jpath("pair_b")])
        ok = write(os.path.join(OUT, "P7A_ok.txt"), "RECORDED_BY: synthetic\nDECISION: APPROVED\nVERBATIM: it looks right\n  (synthetic)\n")
        rej = write(os.path.join(OUT, "P7A_rej.txt"), "DECISION: REJECTED\nVERBATIM: the dog floats\n")
        empty = write(os.path.join(OUT, "P7A_empty.txt"), "DECISION: APPROVED\nVERBATIM:\n")
        two = write(os.path.join(OUT, "P7A_two.txt"), "DECISION: APPROVED\nDECISION: REJECTED\nVERBATIM: x\n")
        anyfile = write(os.path.join(OUT, "P7A_anyfile.txt"), "some note\n")
        self.assertEqual(J.read_p7a(ok), ("APPROVED", "it looks right (synthetic)"))
        text, rc = J.control_vs(*args, ok)
        self.assertEqual(rc, 0, text)
        text, rc = J.control_vs(*args, rej)
        self.assertNotEqual(rc, 0, text)
        self.assertIn("the founder's P7a look is a recorded REJECTION", text)
        self.assertIn("a new governed build and fresh SC3 runs", text)
        for bad in (empty, two, anyfile):
            text, rc = J.control_vs(*args, bad)
            self.assertNotEqual(rc, 0, text)
            self.assertIn("INVALID", text)

    def test_R7_06_echoes(self):
        r1 = run("R7_06_control_missing_echo", echo_omit_observer=("wl.Remote.RttClock",), **CONTROL)
        self.assertEqual(r1["result"], "VOID")
        self.assertTrue(any("wl.remote.rttclock" in w and "not exactly 1" in w for w in r1["result_why"]), r1["result_why"])
        r2 = run("R7_06_judged_extra_echo", echo_extra_observer=('wl.Remote.InterpEaseZ = "120"',))
        self.assertEqual(r2["result"], "VOID")
        self.assertTrue(any("console-set echo wl.Remote.InterpEaseZ" in w for w in r2["result_why"]), r2["result_why"])
        r3 = run("R7_06_sender_other_echo", echo_extra_sender=('wl.Foo.Bar = "1"',))
        self.assertEqual(r3["result"], "VOID")
        r4 = run("perfect")
        self.assertEqual(r4["result"], "PASS", r4.get("result_why"))
        self.assertEqual([e[1] for e in r4["echoes"]["sender"]], ["wl.Remote.LogPeriod"])
        r5 = run("B10_control_fail", pids=(81, 82), air_off=15.0, **CONTROL)
        self.assertEqual(r5["result"], "FAIL", r5.get("result_why"))       # all three echoes present: not VOID
        self.assertEqual(sorted(e[1] for e in r5["echoes"]["observer"]),
                         ["wl.Remote.InterpEaseZ", "wl.Remote.LogPeriod", "wl.Remote.ReportTimeSamples", "wl.Remote.RttClock"])

    def test_R7_07_overrides_refused(self):
        run("pair_a", pids=(11, 12))
        r = run("R7_07_pair_noframes", pids=(41, 42), judge_args={"--no-require-frames": True})
        self.assertEqual(r["overrides"], ["--no-require-frames"])
        text, result = J.pair(jpath("pair_a"), jpath("R7_07_pair_noframes"))
        self.assertEqual(result, "REFUSED", text)
        self.assertIn("R7-07", text)
        r = run("R7_07_pair_expectexe", pids=(43, 44), judge_args={"--expect-exe": SYNTH_EXE})
        text, result = J.pair(jpath("pair_a"), jpath("R7_07_pair_expectexe"))
        self.assertEqual(result, "REFUSED", text)
        run("B10_control_fail", pids=(81, 82), air_off=15.0, **CONTROL)
        p7a = write(os.path.join(OUT, "P7A_APPROVED.txt"), "DECISION: APPROVED\nVERBATIM: SYNTHETIC approval\n")
        text, rc = J.control_vs(jpath("B10_control_fail"), [jpath("pair_a"), jpath("R7_07_pair_noframes")], p7a)
        self.assertNotEqual(rc, 0, text)
        self.assertIn("NOT COMPARABLE", text)

    def test_R7_08_void_shows_the_bars(self):
        rep = run("R7_08_void_air12", air_off=12.0, dev_line_observer=True, pids=(51, 52))
        self.assertEqual(rep["result"], "VOID")
        self.assertEqual(v(rep, "STANDING"), "FAIL")
        self.assertEqual(rep["analysis_result_if_not_void"], "FAIL")
        txt = J.fmt(rep)
        self.assertIn("[VOID run, not a result] STANDING: FAIL", txt)
        self.assertIn("any FAIL here = NOT cleared", txt)
        run("pr_r708/pair_a", pids=(11, 12))
        run("pr_r708/R7_08_void_air12", air_off=12.0, dev_line_observer=True, pids=(51, 52))
        text, result = J.pair(jpath("pr_r708/pair_a"), jpath("pr_r708/R7_08_void_air12"))
        self.assertEqual(result, "VOID", text)

    def test_R8_05_close_hashes(self):
        def tamper(d):
            with open(os.path.join(d, "sender", "Saved", "Logs", "Wonderland.log"), "a", encoding="utf-8") as f:
                f.write("[2026.10.21-12.30.00:000][  1]LogTemp: Display: a line added after the run closed\n")
        r1 = run("R8_05_tampered", mutate=tamper)
        self.assertEqual(r1["result"], "VOID")
        self.assertTrue(any("changed after the run closed" in w for w in r1["result_why"]), r1["result_why"])
        r2 = run("R8_05_not_closed", close=False)
        self.assertEqual(r2["result"], "VOID")
        self.assertTrue(any("not closed by b33_stop.ps1" in w for w in r2["result_why"]), r2["result_why"])
        r3 = run("perfect")
        self.assertGreaterEqual(len(r3["close_check"]["checked"]), 4)

    def test_R7_09_survey_bounds(self):
        import b33_survey_record as SR
        base = SR.load_baseline()
        self.assertEqual(SR.sha256(SR.BASELINE_ROUTE), "788f201566c34d6e96eb74d8d9e7a1243fa24cdf6f3ce66d51b0e615be3672bf")
        new = json.loads(json.dumps(base))
        new["whatever"] = 1
        self.assertTrue(any(b.startswith("whatever") for b in SR.route_diff(base, new)[1]))
        new = json.loads(json.dumps(base))
        new["what"] = "changed text"
        self.assertEqual(SR.route_diff(base, new)[1], [])
        new = json.loads(json.dumps(base))
        new["m4"]["mount"]["kerb_z"] = [100.0, 121.0]
        self.assertTrue(any("kerb_z" in b for b in SR.route_diff(base, new)[1]))
        with open(os.path.join(ROOT, "routes", "b33_route_v2.json"), encoding="utf-8") as f:
            v2 = json.load(f)
        self.assertEqual(SR.route_diff(base, v2)[1], [])
        self.assertFalse(v2["verified"])


def _rep(name):
    for (n, _), rep in _cache.items():
        if n == name:
            return rep
    raise KeyError(name)


@unittest.skipUnless(os.path.isdir(B33A), "b33a run folder not present")
class B33aShift0(unittest.TestCase):
    """M2 checklist B6: the registered analyser at shift 0 FAILS on the recorded b33a run, judged on its drive blocks (v3, B-4)"""
    def test_registered_fails_b33a(self):
        tl = os.path.join(ROOT, "b6_b33a_reanalysis", "b33a_timeline.csv")
        rep = J.judge_run(B33A, {"--sender-log": os.path.join(B33A, "clientA", "Saved", "Logs", "Wonderland.log"),
                                 "--viewer-log": os.path.join(B33A, "clientB", "Saved", "Logs", "Wonderland.log"), "--timeline": tl,
                                 "--no-require-frames": True, "--historical": True, "--expect-exe": B33A_EXE,
                                 "--allow-launch-cmds": "scalability 0;r.ScreenPercentage 50", "--allow-switches": "-forcelogflush"})
        st = rep["scenarios"]["STANDING"]
        self.assertAlmostEqual(st["registered"]["air_p95_abs"], 22.502854324814127, places=9)
        self.assertAlmostEqual(st["registered"]["land_p95_abs"], 2.86, places=6)
        self.assertEqual(st["verdict"], "FAIL")
        self.assertAlmostEqual(rep["scenarios"]["WALKING"]["registered"]["air_p95_abs"], 11.743138997841577, places=9)
        self.assertEqual(rep["result"], "FAIL")


class QM2c5(unittest.TestCase):
    """Q-M2c-5 (b), fixed before data: N = 10 walk-off attempts per counted run, every one listed, exclusion ONLY by the height rule, EVERY
    qualifying fall judged under the bars, < 5 qualifying = INCONCLUSIVE, any other attempt count = INCONCLUSIVE, a bar FAIL on any qualifying
    fall = FAIL; the record: every counted run listed (no hidden run, one exe), a FAIL ends it, at most 2 additional runs each replacing an
    M4-INCONCLUSIVE run, PASS = two runs with every scenario PASS."""
    LOW5 = (111.3,) * 5 + (95.0,) * 5
    LOW6 = (111.3,) * 4 + (95.0,) * 6

    def test_all_ten_attempts_listed_and_judged(self):
        m4 = run("perfect")["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "PASS", m4.get("why"))
        self.assertEqual(len(m4["attempts"]), 10)
        self.assertEqual(m4["attempts_judged_under_bars"], 10)
        self.assertEqual(m4["attempts_pre_stated"], 10)

    def test_low_attempts_excluded_only_by_height_five_qualify_pass(self):
        rep = run("q5_low5", plan=S.default_plan(m4_drops=self.LOW5))
        m4 = rep["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "PASS", m4.get("why"))
        self.assertEqual(len(m4["attempts"]), 10)
        self.assertEqual(m4["qualifying"], 5)
        self.assertEqual(m4["attempts_judged_under_bars"], 5)
        low = [a for a in m4["attempts"] if not a["judged_under_bars"]]
        self.assertEqual(len(low), 5)
        self.assertTrue(all("height rule" in a["excluded_by"] for a in low))
        self.assertIn("excluded by the height rule", J.fmt(rep))

    def test_four_qualifying_is_inconclusive(self):
        m4 = run("q5_low6", plan=S.default_plan(m4_drops=self.LOW6))["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "INCONCLUSIVE")
        self.assertTrue(any("qualifying walked falls 4 < 5" in w for w in m4["why"]), m4["why"])

    def test_attempt_count_other_than_ten_is_inconclusive(self):
        for name, drops in (("q5_nine", (111.3,) * 9), ("q5_eleven", (111.3,) * 11)):
            m4 = run(name, plan=S.default_plan(m4_drops=drops))["scenarios"]["M4"]
            self.assertEqual(m4["verdict"], "INCONCLUSIVE", name)
            self.assertTrue(any("not the pre-stated 10" in w for w in m4["why"]), m4["why"])

    def test_bar_fail_on_a_qualifying_fall_fails_even_with_too_few(self):
        m4 = run("q5_low6_air12", plan=S.default_plan(m4_drops=self.LOW6), air_off=12.0)["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "FAIL", m4.get("why"))

    def _rec(self, root, specs):
        paths = []
        for k, (kind, pid) in enumerate(specs):
            kw = dict(pids=(pid, pid + 1), started_utc="2026-10-21T0%d:00:00Z" % (k + 1))
            if kind == "inc":
                kw["plan"] = S.default_plan(m4_drops=self.LOW6)
            elif kind == "fail":
                kw["air_off"] = 12.0
            elif kind == "exe":
                kw["exe_sha"] = "ef" * 32
            run("%s/r%d_%s" % (root, k + 1, kind), **kw)
            paths.append(jpath("%s/r%d_%s" % (root, k + 1, kind)))
        return paths

    def test_record_rules(self):
        ok = self._rec("rec_ok", [("pass", 200), ("pass", 210)])
        self.assertEqual(J.record(ok)[1], "PASS")
        rp = self._rec("rec_replace", [("inc", 220), ("pass", 230), ("pass", 240)])
        text, res = J.record(rp)
        self.assertEqual(res, "PASS", text)
        self.assertIn("run 3 replaces the M4-INCONCLUSIVE run 1", text)
        self.assertEqual(J.record(self._rec("rec_open", [("inc", 250), ("pass", 260)]))[1], "INCONCLUSIVE")
        cap = self._rec("rec_cap", [("inc", 270), ("inc", 280), ("inc", 290), ("pass", 300), ("pass", 310)])
        text, res = J.record(cap)
        self.assertEqual(res, "REFUSED", text)
        self.assertIn("more than 2 additional", text)
        sel = self._rec("rec_select", [("pass", 320), ("pass", 330), ("pass", 340)])
        text, res = J.record(sel)
        self.assertEqual(res, "REFUSED", text)
        self.assertIn("no M4-INCONCLUSIVE run to replace", text)
        self.assertEqual(J.record(self._rec("rec_fail", [("pass", 350), ("fail", 360)]))[1], "FAIL")
        hid = self._rec("rec_hidden", [("inc", 370), ("pass", 380), ("pass", 390)])
        text, res = J.record(hid[1:])
        self.assertEqual(res, "REFUSED", text)
        self.assertIn("not listed (no run may be hidden)", text)
        exe = self._rec("rec_exe", [("pass", 400), ("exe", 410)])
        text, res = J.record(exe)
        self.assertEqual(res, "REFUSED", text)
        self.assertIn("not of ONE exe", text)


class P78Contamination(unittest.TestCase):
    """P78 (ruling Q-B33-1 condition 4): a JUDGED block whose frozen window (END, END + 1.6 s] holds drive input (KEY / MOUSE / CLICK rows)
    is INCONCLUSIVE for that block's scenario (P78 contamination); a measured bar violation there stays FAIL (R7-02; Q-B33-1 condition 1);
    input after END + 1.6 s is not contamination; an M4 attempt counts only if it is judged under the bars."""

    def test_next_block_input_0_1_s_after_end_is_inconclusive(self):
        rep = run("p78_stand_0p1", post_inputs=[("STAND", 0.10, "KEY_DOWN", "W")])
        st = rep["scenarios"]["STANDING"]
        self.assertEqual(st["verdict"], "INCONCLUSIVE", st.get("why"))
        self.assertTrue(any("P78 contamination" in w and "END + 0.100 s" in w for w in st["why"]), st["why"])
        self.assertEqual(len(st["post_window_inputs"]), 1)
        self.assertEqual(rep["scenarios"]["WALKING"]["verdict"], "PASS")
        self.assertEqual(rep["result"], "INCONCLUSIVE")

    def test_a_mouse_row_counts_as_input(self):
        st = run("p78_walk_mouse", post_inputs=[("WALK", 1.2, "MOUSE", "dx=40")])["scenarios"]["WALKING"]
        self.assertEqual(st["verdict"], "INCONCLUSIVE", st.get("why"))

    def test_input_after_the_window_is_not_contamination(self):
        rep = run("p78_stand_1p7", post_inputs=[("STAND", 1.70, "KEY_DOWN", "W")])
        st = rep["scenarios"]["STANDING"]
        self.assertEqual(st["verdict"], "PASS", st.get("why"))
        self.assertEqual(st["post_window_inputs"], [])

    def test_a_bar_violation_in_a_contaminated_block_stays_fail(self):
        st = run("p78_stand_air12", air_off=12.0, post_inputs=[("STAND", 0.10, "KEY_DOWN", "W")])["scenarios"]["STANDING"]
        self.assertEqual(st["verdict"], "FAIL", st.get("why"))

    def test_judged_m4_attempt_contaminated_is_inconclusive(self):
        rep = run("p78_m4_3", post_inputs=[("M4_3", 0.30, "MOUSE", "dx=120")])
        m4 = rep["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "INCONCLUSIVE", m4.get("why"))
        self.assertTrue(any("P78 contamination: the M4_3 block" in w for w in m4["why"]), m4["why"])
        self.assertEqual([a["post_window_inputs"] for a in m4["attempts"]][2], 1)
        self.assertIn("[P78: 1 drive input row(s) in its window after its end]", J.fmt(rep))

    def test_excluded_m4_attempt_is_not_judged_so_not_counted(self):
        drops = (95.0,) + (111.3,) * 9
        m4 = run("p78_m4_excluded", plan=S.default_plan(m4_drops=drops), post_inputs=[("M4_1", 0.30, "MOUSE", "dx=120")])["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "PASS", m4.get("why"))
        self.assertEqual(m4["attempts"][0]["post_window_inputs"], 1)


class RingEvidence(unittest.TestCase):
    """v3.1k P82: the judge's RING EVIDENCE (transport ring, r16reh18) is DESCRIPTIVE: per block the trail insertions (ins=1), the dropped
    repeats (ins=0) and max k/n; the coverage of moving sender reports by the viewer's stored samples; every settled sample's residual (the
    same W2 D4 arithmetic, so its minimum equals the judge's); the --ring-compare table. No verdict changes with it."""

    def test_without_the_ring_some_reports_are_lost_and_no_trail(self):
        rep = run("ring_plain")
        for sc in ("STANDING", "WALKING", "RUNNING", "M4"):
            ev = rep["scenarios"][sc]["ring"]
            self.assertEqual(ev["trail_lines_in_log"], 0)
            self.assertEqual(sum(b["trail_inserted"] for b in ev["blocks"]), 0)
            self.assertTrue(ev["settle"]["matches_registered_min"], sc)
        self.assertLess(rep["scenarios"]["RUNNING"]["ring"]["coverage_pct"], 100.0)

    def test_with_the_ring_every_moving_report_reaches_the_viewer_and_verdicts_are_unchanged(self):
        plain = run("ring_plain2")
        ring = run("ring_on", ring=True, ring_repeat_every=3)
        for sc in ("STANDING", "WALKING", "RUNNING", "M4"):
            ev = ring["scenarios"][sc]["ring"]
            self.assertEqual(ev["coverage_pct"], 100.0, (sc, ev["blocks"]))
            self.assertGreater(sum(b["trail_inserted"] for b in ev["blocks"]), 0, sc)
            self.assertGreaterEqual(max(b["max_k"] for b in ev["blocks"]), 1)
            self.assertEqual(ring["scenarios"][sc]["verdict"], plain["scenarios"][sc]["verdict"], sc)
            self.assertEqual(ring["scenarios"][sc]["registered"], plain["scenarios"][sc]["registered"], sc)
        self.assertGreater(sum(b["trail_repeats_dropped"] for sc in ("STANDING", "WALKING", "RUNNING", "M4")
                               for b in ring["scenarios"][sc]["ring"]["blocks"]), 0)
        self.assertEqual(ring["result"], plain["result"])
        self.assertIn("RING EVIDENCE (v3.1k P82; DESCRIPTIVE ONLY", J.fmt(ring))

    def test_settle_residuals_list_every_settled_sample(self):
        sunk = run("ring_sink3", sink=-3.0)
        st = sunk["scenarios"]["STANDING"]["ring"]["settle"]
        self.assertTrue(st["matches_registered_min"])
        self.assertGreater(st["n_below_minus2"], 0)
        self.assertLess(st["min"], -2.0)
        self.assertEqual(sunk["scenarios"]["STANDING"]["verdict"], "FAIL")
        clean = run("ring_plain3")["scenarios"]["STANDING"]["ring"]["settle"]
        self.assertEqual(clean["n_below_minus2"], 0)

    def test_ring_compare_prints_both_runs(self):
        for n in ("ring_cmp_a", "ring_cmp_b"):
            shutil.rmtree(os.path.join(OUT, n), ignore_errors=True)
        a = S.build(os.path.join(OUT, "ring_cmp_a"), ring=True)
        b = S.build(os.path.join(OUT, "ring_cmp_b"))
        text, reps = J.ring_compare(a, b, {})
        self.assertIn("RING COMPARE", text)
        self.assertEqual(len(reps), 2)
        rows = [l for l in text.splitlines() if l.startswith("RUNNING")]
        self.assertEqual(len(rows), 2)
        self.assertIn("100.0", rows[0])


class QB332PerAttemptSinking(unittest.TestCase):
    """Q-B33-2 = 392923 (b), fixed before data: the M4 sinking windows are PER ATTEMPT (each attempt is its own block), from that attempt's
    touchdown + 0.5 s to the next takeoff or its block end; a touchdown never opens a settle window in another block. Fixtures (i)-(iv) as
    ruled, and a mutant that restores the join, caught by (i). The -2.0 floor, the 0.5 s offset and the window end are unchanged."""
    GAP = 4.0     # the return between attempts (outside every block), as the drive has it (P78)

    def plan(self):
        return S.default_plan(m4_gap_s=self.GAP)

    def test_i_sink_in_attempt_k1_before_its_own_touchdown_is_not_judged(self):
        rep = run("qb332_i", plan=self.plan(), sink_blocks=[("M4_2", "begin", 0.3, 1.3, -3.0)])
        m4 = rep["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "PASS", m4.get("why"))
        self.assertGreaterEqual(m4["registered_settle"]["settle_min_gap"], -2.0)

    def test_ii_sink_in_attempt_k_after_touchdown_inside_its_block_fails(self):
        m4 = run("qb332_ii", plan=self.plan(), sink_blocks=[("M4_2", "end", -1.2, -0.3, -3.0)])["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "FAIL", m4.get("why"))
        self.assertTrue(any("sinking" in w for w in m4["why"]), m4["why"])

    def test_iii_sink_in_the_return_walk_between_blocks_is_not_judged(self):
        m4 = run("qb332_iii", plan=self.plan(), sink_blocks=[("M4_2", "end", 2.2, 3.5, -3.0)])["scenarios"]["M4"]
        self.assertEqual(m4["verdict"], "PASS", m4.get("why"))

    def test_iv_exactly_minus_2_passes_and_minus_2_001_fails(self):
        sender = [(0.0, "IDLE", 10.0, 0.0), (0.5, "JUMP", 40.0, 0.0), (0.8, "FALL", 20.0, 0.0), (1.0, "IDLE", 10.0, 0.0),
                  (1.5, "IDLE", 10.0, 0.0), (2.0, "IDLE", 10.0, 0.0), (3.0, "IDLE", 10.0, 0.0)]
        for zv, want_fail in ((8.0, False), (7.999, True)):
            viewer = [(2.3, "f", "IDLE", zv, 0.3)]
            n, m, per = J.settle_per_block(sender, viewer, [(0, len(sender) - 1)])
            self.assertEqual(n, 1)
            r = {"air_p95_abs": None, "land_p95_abs": None, "settle_min_gap": m, "viewer_samples": 1, "viewer_recv_air_labels": 1}
            viol = J.bar_violations(r, "registered")
            self.assertEqual(bool(viol), want_fail, (zv, m, viol))

    def test_the_join_mutant_is_caught_by_fixture_i(self):
        real = J.settle_per_block

        def join_mutant(sender, viewer, ranges):          # the v3 behaviour: every block's tuples analysed as ONE sequence
            s1, v1, _ = J.stitch(sender, viewer, ranges)
            r = W.analyse(s1, v1, 0.0)
            return r["settle_n"], r["settle_min_gap"], []
        try:
            J.settle_per_block = join_mutant
            d = os.path.join(OUT, "qb332_i_mutant")
            shutil.rmtree(d, ignore_errors=True)
            S.build(d, plan=self.plan(), sink_blocks=[("M4_2", "begin", 0.3, 1.3, -3.0)])
            m4 = J.judge_run(d, {})["scenarios"]["M4"]
        finally:
            J.settle_per_block = real
        self.assertEqual(m4["verdict"], "FAIL", "the join mutant must FAIL fixture (i), so fixture (i) catches it")

    def test_every_block_is_its_own_settle_window_in_the_jump_scenarios_too(self):
        rep = run("qb332_plain", plan=self.plan())
        for sc in ("STANDING", "WALKING", "RUNNING", "M4"):
            self.assertEqual(rep["scenarios"][sc]["verdict"], "PASS", (sc, rep["scenarios"][sc].get("why")))
            self.assertTrue(rep["scenarios"][sc]["registered_settle"]["per_block"])
        self.assertEqual(len(rep["scenarios"]["M4"]["settle_per_block"]["registered"]), 10)


class Pins(unittest.TestCase):
    """v3.1: the shipped slots are PENDING and refuse a counted run (the judge VOIDs); a PINNED slot that does not match VOIDs too."""

    def test_shipped_candidate_relay_and_route_slots_are_pending(self):
        for f, key in ((SHIPPED_CANDIDATE, "status"), (SHIPPED_RELAY_PIN, "status"), (SHIPPED_ROUTE_PIN, "status")):
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
            self.assertTrue(str(d[key]).startswith("PENDING"), (f, d[key]))
        with open(SHIPPED_CANDIDATE, encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["label"], "0.1.0-r16reh18")

    def test_pending_relay_pin_voids(self):
        rep = J.judge_run(run_dir("pin_relay"), {"--relay-pin-file": SHIPPED_RELAY_PIN})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("RELAY_PIN.json" in w and "not PINNED" in w for w in rep["result_why"]), rep["result_why"])

    def test_pending_route_pin_voids_a_run_with_m4(self):
        rep = J.judge_run(run_dir("pin_route"), {"--route-pin-file": SHIPPED_ROUTE_PIN})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("ROUTE_PIN.json" in w and "not PINNED" in w for w in rep["result_why"]), rep["result_why"])

    def test_relay_mismatch_voids(self):
        p = os.path.join(OUT, "candidates", "relay_pin_other.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"status": "PINNED", "commit": "f157b8216ae03db7feed849a2c91f1a5610e99ed", "tree": "0bfce9f58a3e03ed22b60a7a2b93ccca194f25e4"}, fh)
        rep = J.judge_run(run_dir("pin_relay_other"), {"--relay-pin-file": p})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("is not the relay pin" in w for w in rep["result_why"]), rep["result_why"])

    def test_route_mismatch_voids(self):
        p = os.path.join(OUT, "candidates", "route_pin_other.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"status": "PINNED", "route_sha256": "0" * 64}, fh)
        rep = J.judge_run(run_dir("pin_route_other"), {"--route-pin-file": p})
        self.assertEqual(rep["result"], "VOID")
        self.assertTrue(any("is not the pinned route" in w for w in rep["result_why"]), rep["result_why"])

    def test_a_jumps_only_run_needs_no_route_pin(self):
        plan = S.default_plan(m4_drops=())
        d = os.path.join(OUT, "pin_jumps_only")
        shutil.rmtree(d, ignore_errors=True)
        S.build(d, plan=plan)
        rep = J.judge_run(d, {"--route-pin-file": SHIPPED_ROUTE_PIN})
        self.assertFalse(any("ROUTE_PIN" in w for w in rep.get("result_why", [])), rep.get("result_why"))
        self.assertFalse(rep["route_pin"]["checked"])

    def test_pin_file_overrides_are_refused_by_pair(self):
        self.assertIn("--relay-pin-file", J.OVERRIDE_FLAGS)
        self.assertIn("--route-pin-file", J.OVERRIDE_FLAGS)


def run_dir(name, **kw):
    d = os.path.join(OUT, name)
    shutil.rmtree(d, ignore_errors=True)
    S.build(d, **kw)
    return d


REHEARSAL_RUNS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "dev_notes", "REHEARSAL_NOT_PREREG_b33_runs"))


class V31aRules(unittest.TestCase):
    """v3.1a (ruling 7a7faf): P2-1 (a) chosen before data -- an M4-INCONCLUSIVE run is replaceable ONLY for the 3fab1b cause "fewer than 5
    qualifying falls"; P78 contamination or any other M4 INCONCLUSIVE reason is NOT replaceable (the record is INCONCLUSIVE, the reviewer
    rules). P2-2 -- runs that are never counted (role SURVEY / REHEARSAL_NOT_PREREG, or an older survey / NOT-PREREG folder) are not in the
    run listing, so they never make a record REFUSED. P2-4 -- the judge records the lease gate and the RAM readings (descriptive)."""
    LOW6 = (111.3,) * 4 + (95.0,) * 6

    def _runs(self, root, specs):
        paths = []
        for k, (kind, pid) in enumerate(specs):
            kw = dict(pids=(pid, pid + 1), started_utc="2026-10-21T0%d:00:00Z" % (k + 1))
            if kind == "low":
                kw["plan"] = S.default_plan(m4_drops=self.LOW6)
            elif kind == "zero":
                kw["plan"] = S.default_plan(m4_drops=(95.0,) * 10)
            elif kind == "p78":
                kw["post_inputs"] = [("M4_3", 0.30, "MOUSE", "dx=120")]
            elif kind == "nine":
                kw["plan"] = S.default_plan(m4_drops=(111.3,) * 9)
            run("%s/r%d_%s" % (root, k + 1, kind), **kw)
            paths.append(jpath("%s/r%d_%s" % (root, k + 1, kind)))
        return paths

    def test_replaceable_cause_fewer_than_5_qualifying(self):
        p = self._runs("v31a_rep_low", [("low", 500), ("pass", 510), ("pass", 520)])
        ok, other = J.m4_replaceable(J._load(p[0]))
        self.assertTrue(ok, other)
        text, res = J.record(p)
        self.assertEqual(res, "PASS", text)
        self.assertIn("run 3 replaces the M4-INCONCLUSIVE run 1", text)

    def test_zero_qualifying_is_the_same_cause(self):
        p = self._runs("v31a_rep_zero", [("zero", 530), ("pass", 540), ("pass", 550)])
        rep = J._load(p[0])
        self.assertIn("no drive block of this scenario", rep["scenarios"]["M4"]["why"])
        ok, other = J.m4_replaceable(rep)
        self.assertTrue(ok, other)
        self.assertEqual(J.record(p)[1], "PASS")

    def test_p78_contamination_is_not_replaceable(self):
        p = self._runs("v31a_norep_p78", [("p78", 560), ("pass", 570), ("pass", 580)])
        rep = J._load(p[0])
        self.assertEqual(rep["scenarios"]["M4"]["verdict"], "INCONCLUSIVE")
        self.assertTrue(any("P78 contamination" in w for w in rep["scenarios"]["M4"]["why"]))
        self.assertFalse(J.m4_replaceable(rep)[0])
        text, res = J.record(p)
        self.assertEqual(res, "INCONCLUSIVE", text)
        self.assertIn("NOT replaceable", text)

    def test_other_cause_attempt_count_is_not_replaceable(self):
        p = self._runs("v31a_norep_nine", [("nine", 590), ("pass", 600), ("pass", 610)])
        rep = J._load(p[0])
        self.assertTrue(any("not the pre-stated 10" in w for w in rep["scenarios"]["M4"]["why"]))
        self.assertFalse(J.m4_replaceable(rep)[0])
        text, res = J.record(p)
        self.assertEqual(res, "INCONCLUSIVE", text)
        self.assertIn("NOT replaceable", text)

    def test_survey_and_rehearsal_folders_beside_two_pass_runs_do_not_refuse_the_record(self):
        shutil.rmtree(os.path.join(OUT, "v31a_listing"), ignore_errors=True)
        p = self._runs("v31a_listing", [("pass", 620), ("pass", 630)])
        root = os.path.join(OUT, "v31a_listing")
        S.build(os.path.join(root, "SURVEY_b33_20261021T130000Z"), role="SURVEY", run_extra={"scenario": "survey"}, pids=(640, 641))
        S.build(os.path.join(root, "DIAGNOSTIC_b33_survey_20261021T131000Z"), run_extra={"scenario": "survey"}, pids=(650, 651))   # an older survey folder, role JUDGED
        S.build(os.path.join(root, "REHEARSAL_NOT_PREREG_b33_all_20261021T132000Z"), role="REHEARSAL_NOT_PREREG", pids=(660, 661))
        S.build(os.path.join(root, "DIAGNOSTIC_b33_all_20261021T133000Z"), pids=(670, 671),
                server={"prereg": False, "kind": "NOT-PREREG OVERRIDE", "port": 8796})   # an older -ServerTree folder, role JUDGED
        text, res = J.record(p)
        self.assertEqual(res, "PASS", text)
        S.build(os.path.join(root, "DIAGNOSTIC_b33_all_20261021T134000Z"), pids=(680, 681))   # a real JUDGED run: it must still be listed
        text, res = J.record(p)
        self.assertEqual(res, "REFUSED", text)
        self.assertIn("not listed (no run may be hidden)", text)

    def test_ram_is_recorded_and_decides_nothing(self):
        d = os.path.join(OUT, "v31a_ram")
        shutil.rmtree(d, ignore_errors=True)
        S.build(d, run_extra={"lease_gb": 5.0, "in_run_guard_gb": 1.1})
        before = J.judge_run(d, {})
        with open(os.path.join(d, "RAM_LOG.json"), "w", encoding="utf-8") as f:
            json.dump({"lease_gb": 5.0, "ram_free_gb_at_start": 7.9, "in_run_guard_gb": 1.1, "in_run_min_free_gb": 0.9, "in_run_readings": 300,
                       "guard_tripped": True}, f)
        after = J.judge_run(d, {})
        self.assertEqual(after["ram"]["lease_gb"], 5.0)
        self.assertEqual(after["ram"]["in_run"]["in_run_min_free_gb"], 0.9)
        self.assertTrue(after["ram"]["in_run"]["guard_tripped"])
        self.assertEqual(after["result"], before["result"])
        self.assertEqual({k: v["verdict"] for k, v in after["scenarios"].items()}, {k: v["verdict"] for k, v in before["scenarios"].items()})
        self.assertIn("RAM (descriptive, never a verdict", J.fmt(after))


class ZRingNoVerdictChange(unittest.TestCase):
    """v3.1 P82 (392923: 'with a test proving it cannot change any verdict'): every report, with the descriptive ring block ON and OFF, is
    byte-equal once the ring block is removed -- over EVERY fixture run folder built by this suite (this class runs last) and EVERY
    rehearsal run on disk (dev_notes\\REHEARSAL_NOT_PREREG_b33_runs\\DIAGNOSTIC_*)."""

    @staticmethod
    def strip(rep):
        r = json.loads(json.dumps(rep, default=str))
        for sc in (r.get("scenarios") or {}).values():
            sc.pop("ring", None)
        for k in ("analysis_scenarios_if_not_void",):
            for sc in ((r.get(k) or {}).values() if isinstance(r.get(k), dict) else []):
                if isinstance(sc, dict):
                    sc.pop("ring", None)
        return json.dumps(r, sort_keys=True, default=str)

    def judge_both(self, d):
        def judge(flag):
            J.RING_EVIDENCE = flag
            try:
                return J.judge_run(d, {})
            except SystemExit as e:        # a folder the judge cannot read (no logs): the same refusal with the block on and off
                return {"refused": str(e)}
        old = J.RING_EVIDENCE
        try:
            on, off = judge(True), judge(False)
        finally:
            J.RING_EVIDENCE = old
        return on, off

    def test_every_fixture_run_byte_equal(self):
        dirs = sorted(os.path.join(OUT, n) for n in os.listdir(OUT) if os.path.exists(os.path.join(OUT, n, "RUN.json")))
        self.assertGreater(len(dirs), 20)
        rings = 0
        for d in dirs:
            on, off = self.judge_both(d)
            self.assertEqual(self.strip(on), self.strip(off), d)
            self.assertFalse(any("ring" in (sc or {}) for sc in (off.get("scenarios") or {}).values()), d)
            rings += sum(1 for sc in (on.get("scenarios") or {}).values() if "ring" in (sc or {}))
        self.assertGreater(rings, 0)

    def test_every_rehearsal_run_on_disk_byte_equal(self):
        if not os.path.isdir(REHEARSAL_RUNS):
            self.skipTest("no rehearsal runs folder at %s" % REHEARSAL_RUNS)
        dirs = sorted(os.path.join(REHEARSAL_RUNS, n) for n in os.listdir(REHEARSAL_RUNS)
                      if n.startswith("DIAGNOSTIC_") and os.path.exists(os.path.join(REHEARSAL_RUNS, n, "RUN.json")))
        self.assertGreater(len(dirs), 5)
        judged = 0
        for d in dirs:
            on, off = self.judge_both(d)
            self.assertEqual(self.strip(on), self.strip(off), d)
            judged += "refused" not in on
        self.assertGreater(judged, 5)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    unittest.main(verbosity=2)
