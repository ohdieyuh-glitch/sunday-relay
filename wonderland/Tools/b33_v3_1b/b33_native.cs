// b33_native.cs -- native helpers for b33_drive.ps1 / b33_frames.ps1 (W2DEV). DIAGNOSTIC tool, W2DEV, not evidence by itself.
// Compiled by Windows PowerShell 5.1 Add-Type (C# 5: no string interpolation, no expression-bodied members, no out var).
//   B33.Inp      SendInput only (keys with scan codes, relative mouse, left click); every event carries dwExtraInfo = MAGIC; counts its calls
//   B33.Guard    WH_KEYBOARD_LL + WH_MOUSE_LL on their own thread with a message loop: counts OUR injected events (MAGIC), FOREIGN injected
//                events and HARDWARE events (a person). Flags: LLKHF_INJECTED|LLKHF_LOWER_IL_INJECTED 0x12, LLMHF_INJECTED|LOWER_IL 0x03.
//   B33.Win      foreground / window-from-point / client rect / topmost (SWP_NOACTIVATE) / DPI awareness
//   B33.LogTail  incremental reader of a growing Wonderland.log: "WLREMOTE send motion=" + "send soles=" lines -> samples on the game clock
//                (cumulative period=) placed on the wall clock by the running minimum of (stamp - game clock) (a stamp is never early)
//   B33.Sim      DRY RUN ONLY: a kinematic Dog (jog 230, run 520, jump 420, gravity 980, step-up <= 30 uu, walk-off falls) on a rectangle
//                terrain MODEL from the route file, reporting like the client (~117-165 ms). Not the game; it only exercises the drive's logic.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace B33
{
    public static class Inp
    {
        public const long MAGIC = 0x0B33B330;
        public static int Calls = 0;
        [StructLayout(LayoutKind.Sequential)] public struct KB { public ushort vk, sc; public uint fl, t; public IntPtr ex; }
        [StructLayout(LayoutKind.Sequential)] public struct MS { public int dx, dy; public uint md, fl, t; public IntPtr ex; }
        [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MS mi; [FieldOffset(0)] public KB ki; }
        [StructLayout(LayoutKind.Sequential)] public struct IN { public uint type; public U u; }
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, IN[] i, int sz);
        [DllImport("user32.dll")] static extern uint MapVirtualKey(uint c, uint m);
        public static uint Key(ushort vk, bool down)
        {
            Calls++;
            IN[] a = new IN[1];
            a[0].type = 1; a[0].u.ki.vk = vk; a[0].u.ki.sc = (ushort)MapVirtualKey(vk, 0); a[0].u.ki.fl = down ? 0u : 2u; a[0].u.ki.ex = (IntPtr)MAGIC;
            return SendInput(1, a, Marshal.SizeOf(typeof(IN)));
        }
        public static uint Rel(int dx, int dy)
        {
            Calls++;
            IN[] a = new IN[1];
            a[0].type = 0; a[0].u.mi.dx = dx; a[0].u.mi.dy = dy; a[0].u.mi.fl = 1; a[0].u.mi.ex = (IntPtr)MAGIC;
            return SendInput(1, a, Marshal.SizeOf(typeof(IN)));
        }
        /// <summary>v3.1d PACED relative mouse: `total` counts in chunks of at most `chunk` counts, one chunk every `intervalMs` on a Stopwatch
        /// schedule (a late chunk is caught up at once), each with MAGIC. Before EVERY chunk: no other input since baseOthers (Guard), the
        /// foreground window and the window under the cursor belong to one of `pids`; otherwise it stops. Returns the counts sent.
        /// Why: the game has bEnableMouseSmoothing=True (DefaultInput.ini:15 at a82b2a5d) and UE 5.8's UPlayerInput::SmoothMouse rescales
        /// each frame's delta by its learned sample rate and extrapolates empty frames; one 20-count step per ~16 ms against ~11 ms frames
        /// gave +31.8 / -39.9 / +30.5 deg for the same 168 counts (rehearsal 4). The drive's default (1 count / 2 ms, several samples per
        /// frame, like a real high-rate mouse) keeps a model of that code within 0.98..1.01 x (REHEARSAL_FINDINGS F28).</summary>
        public static int RelPaced(int total, int chunk, double intervalMs, int baseOthers, uint[] pids)
        {
            Stopwatch sw = Stopwatch.StartNew();
            int sent = 0, left = total, k = 0;
            chunk = Math.Max(1, chunk);
            while (left != 0)
            {
                if (Guard.Others != baseOthers) return sent;
                if (Array.IndexOf(pids, Win.FgPid()) < 0 || Array.IndexOf(pids, Win.CursorPid()) < 0) return sent;
                int c = Math.Max(-chunk, Math.Min(chunk, left));
                Rel(c, 0); sent += c; left -= c; k++;
                double due = k * intervalMs;
                while (sw.Elapsed.TotalMilliseconds < due) Thread.Yield();
            }
            return sent;
        }
        public static uint Click()
        {
            Calls++;
            IN[] a = new IN[2];
            a[0].type = 0; a[0].u.mi.fl = 2; a[0].u.mi.ex = (IntPtr)MAGIC;
            a[1].type = 0; a[1].u.mi.fl = 4; a[1].u.mi.ex = (IntPtr)MAGIC;
            return SendInput(2, a, Marshal.SizeOf(typeof(IN)));
        }
    }

    public static class Guard
    {
        delegate IntPtr HookProc(int nCode, IntPtr w, IntPtr l);
        [StructLayout(LayoutKind.Sequential)] struct KBDLL { public uint vk, sc, flags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct PT { public int x, y; }
        [StructLayout(LayoutKind.Sequential)] struct MSLL { public PT pt; public uint data, flags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr h; public uint msg; public IntPtr w, l; public uint time; public PT pt; }
        [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint tid);
        [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
        [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid, uint msg, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
        static HookProc kp, mp;
        static IntPtr kh = IntPtr.Zero, mh = IntPtr.Zero;
        static uint tid;
        static Thread th;
        public static volatile int Ours = 0, Foreign = 0, Hardware = 0;
        public static string LastOther = "";
        public static long LastOtherUtcMs = 0;
        static void Note(string what) { LastOther = what; LastOtherUtcMs = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
        static IntPtr KProc(int n, IntPtr w, IntPtr l)
        {
            if (n >= 0)
            {
                KBDLL k = (KBDLL)Marshal.PtrToStructure(l, typeof(KBDLL));
                bool inj = (k.flags & 0x12) != 0;
                if (inj && (long)k.extra == Inp.MAGIC) Ours++;
                else if (inj) { Foreign++; Note("foreign injected key vk=0x" + k.vk.ToString("X2")); }
                else { Hardware++; Note("HARDWARE key vk=0x" + k.vk.ToString("X2")); }
            }
            return CallNextHookEx(kh, n, w, l);
        }
        static IntPtr MProc(int n, IntPtr w, IntPtr l)
        {
            if (n >= 0)
            {
                MSLL m = (MSLL)Marshal.PtrToStructure(l, typeof(MSLL));
                bool inj = (m.flags & 0x03) != 0;
                if (inj && (long)m.extra == Inp.MAGIC) Ours++;
                else if (inj) { Foreign++; Note("foreign injected mouse msg=0x" + w.ToInt64().ToString("X")); }
                else { Hardware++; Note("HARDWARE mouse msg=0x" + w.ToInt64().ToString("X")); }
            }
            return CallNextHookEx(mh, n, w, l);
        }
        public static bool Start()
        {
            if (th != null) return kh != IntPtr.Zero && mh != IntPtr.Zero;
            kp = KProc; mp = MProc;
            ManualResetEvent ready = new ManualResetEvent(false);
            th = new Thread(delegate ()
            {
                tid = GetCurrentThreadId();
                IntPtr mod = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
                kh = SetWindowsHookEx(13, kp, mod, 0);
                mh = SetWindowsHookEx(14, mp, mod, 0);
                ready.Set();
                MSG msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
                if (kh != IntPtr.Zero) UnhookWindowsHookEx(kh);
                if (mh != IntPtr.Zero) UnhookWindowsHookEx(mh);
            });
            th.IsBackground = true;
            th.Start();
            ready.WaitOne(3000);
            return kh != IntPtr.Zero && mh != IntPtr.Zero;
        }
        public static void Stop() { if (th != null) PostThreadMessage(tid, 0x0012, IntPtr.Zero, IntPtr.Zero); }
        public static int Others { get { return Foreign + Hardware; } }
    }

    public static class Win
    {
        [StructLayout(LayoutKind.Sequential)] public struct RC { public int L, T, R, B; }
        [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RC r);
        [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PT p);
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PT p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc fn, IntPtr l);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        delegate bool EnumProc(IntPtr h, IntPtr l);
        public static uint PidOf(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
        public static uint FgPid() { return PidOf(GetForegroundWindow()); }
        public static string ClassOf(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
        public static string TitleOf(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
        public static string FgClass() { return ClassOf(GetForegroundWindow()); }
        public static void ToFront(IntPtr h)
        {
            uint d; uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out d); uint me = GetCurrentThreadId();
            AttachThreadInput(me, fg, true); ShowWindow(h, 9); BringWindowToTop(h); SetForegroundWindow(h); AttachThreadInput(me, fg, false);
        }
        public static void Topmost(IntPtr h, bool on)
        {
            // SWP_NOMOVE 0x2 | SWP_NOSIZE 0x1 | SWP_NOACTIVATE 0x10: z-order only, never focus
            SetWindowPos(h, on ? new IntPtr(-1) : new IntPtr(-2), 0, 0, 0, 0, 0x13);
        }
        // ---- PHYSICAL PIXELS EVERYWHERE: every coordinate call below runs with the calling thread set to PER_MONITOR_AWARE_V2 (context -4) and
        // restores the thread's previous context after, so the launcher (placement), the drive (click point, window/cursor checks) and the
        // frame capture all read and write the SAME physical rectangles whatever the PowerShell process's own DPI awareness is.
        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RC r);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out PT p);
        static readonly IntPtr PMV2 = new IntPtr(-4);
        static IntPtr Pm() { try { return SetThreadDpiAwarenessContext(PMV2); } catch (EntryPointNotFoundException) { return IntPtr.Zero; } }
        static void Restore(IntPtr old) { if (old != IntPtr.Zero) { try { SetThreadDpiAwarenessContext(old); } catch (EntryPointNotFoundException) { } } }
        /// <summary>true if this Windows supports a per-thread PER_MONITOR_AWARE_V2 context (Windows 10 1703+)</summary>
        public static bool PerMonitorV2Available() { IntPtr o = Pm(); bool ok = o != IntPtr.Zero; Restore(o); return ok; }
        /// <summary>the whole process PER_MONITOR_AWARE_V2 (call before any window of this process exists); false if refused</summary>
        public static bool MakeProcessPerMonitorV2() { try { return SetProcessDpiAwarenessContext(PMV2); } catch (EntryPointNotFoundException) { return false; } }
        /// <summary>a client point (percent) on screen + the pid that owns the root window under it (no click)</summary>
        public static uint Probe(IntPtr h, int xp, int yp, out int sx, out int sy)
        {
            IntPtr o = Pm();
            try
            {
                RC r; GetClientRect(h, out r); PT p; p.X = r.R * xp / 100; p.Y = r.B * yp / 100; ClientToScreen(h, ref p); sx = p.X; sy = p.Y;
                IntPtr w = WindowFromPoint(p); IntPtr root = GetAncestor(w, 2); return PidOf(root != IntPtr.Zero ? root : w);
            }
            finally { Restore(o); }
        }
        public static uint PidAt(int x, int y)
        {
            IntPtr o = Pm();
            try { PT p; p.X = x; p.Y = y; IntPtr w = WindowFromPoint(p); IntPtr root = GetAncestor(w, 2); return PidOf(root != IntPtr.Zero ? root : w); }
            finally { Restore(o); }
        }
        /// <summary>the pid that owns the root window under the mouse cursor now</summary>
        public static uint CursorPid() { IntPtr o = Pm(); try { PT p; GetCursorPos(out p); return PidAt(p.X, p.Y); } finally { Restore(o); } }
        public static bool MoveCursor(int x, int y) { IntPtr o = Pm(); try { return SetCursorPos(x, y); } finally { Restore(o); } }
        // ---- CURSOR CLIP (REHEARSAL PATCH P1, lead 10-20 B35 rehearsal: the FOREGROUND game clips the cursor to its own client rect, measured
        // GetClipCursor = 970,39,1910,1070 while the right-hand client was foreground; SetCursorPos to the OTHER window then stops at the clip edge)
        [DllImport("user32.dll")] static extern bool GetClipCursor(out RC r);
        [DllImport("user32.dll")] static extern bool ClipCursor(IntPtr r);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
        /// <summary>the current cursor clip (GetClipCursor; the whole virtual screen when nothing clips it), physical pixels; read only</summary>
        public static RC ClipRect() { IntPtr o = Pm(); try { RC r; GetClipCursor(out r); return r; } finally { Restore(o); } }
        /// <summary>ClipCursor(NULL): the cursor may move anywhere again (no input event; the foreground game may clip again later)</summary>
        public static bool ReleaseClip() { return ClipCursor(IntPtr.Zero); }
        /// <summary>the virtual desktop (SM_X/Y/CX/CYVIRTUALSCREEN) read in the PER_MONITOR_AWARE_V2 context; for the NOTE only, never a decision</summary>
        public static RC VirtualDesktop()
        {
            IntPtr o = Pm();
            try { RC r; r.L = GetSystemMetrics(76); r.T = GetSystemMetrics(77); r.R = r.L + GetSystemMetrics(78); r.B = r.T + GetSystemMetrics(79); return r; }
            finally { Restore(o); }
        }
        /// <summary>the cursor position now (GetCursorPos), physical pixels; read only</summary>
        public static PT CursorXY() { IntPtr o = Pm(); try { PT p; GetCursorPos(out p); return p; } finally { Restore(o); } }
        public static RC ClientOnScreen(IntPtr h)
        {
            IntPtr o = Pm();
            try
            {
                RC r; GetClientRect(h, out r); PT a; a.X = 0; a.Y = 0; ClientToScreen(h, ref a);
                RC c; c.L = a.X; c.T = a.Y; c.R = a.X + r.R; c.B = a.Y + r.B; return c;
            }
            finally { Restore(o); }
        }
        /// <summary>the window's frame rectangle (GetWindowRect: what SetWindowPos sets, incl. the invisible resize borders), physical pixels</summary>
        public static RC FrameRect(IntPtr h) { IntPtr o = Pm(); try { RC r; GetWindowRect(h, out r); return r; } finally { Restore(o); } }
        /// <summary>move/size a window: SetWindowPos(h, 0, x, y, w, h, SWP_NOZORDER 0x4 | SWP_NOACTIVATE 0x10) from a PER_MONITOR_AWARE_V2 thread</summary>
        public static bool Place(IntPtr h, int x, int y, int w, int hgt) { IntPtr o = Pm(); try { return SetWindowPos(h, IntPtr.Zero, x, y, w, hgt, 0x14); } finally { Restore(o); } }
        /// <summary>visible top-level windows whose title contains the text (e.g. the Windows Defender Firewall "Windows Security Alert")</summary>
        public static string FindVisibleTitle(string part)
        {
            string found = "";
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                if (IsWindowVisible(h)) { string t = TitleOf(h); if (t.IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0) { found = t + " (pid " + PidOf(h) + ")"; return false; } }
                return true;
            }, IntPtr.Zero);
            return found;
        }
    }

    public class Sample
    {
        public double StampMs, G, Z, Vz, PeriodMs, X, Y, Sz, Yaw;
        public string Motion;
        public bool HasPos;
        public bool Air { get { return Motion == "JUMP" || Motion == "FALL" || Motion == "FLY"; } }
    }

    public class LogTail
    {
        readonly string path;
        long pos = 0;
        readonly Decoder dec = new UTF8Encoding(false).GetDecoder();
        readonly StringBuilder carry = new StringBuilder();
        public readonly List<Sample> S = new List<Sample>();
        double g = 0; bool any = false;
        public double Env = double.MaxValue;
        public int Lines = 0, Dev = 0;
        public string LastDevLine = "";
        static readonly Regex RStamp = new Regex(@"^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]");
        static readonly Regex RSend = new Regex(@"WLREMOTE send motion=(\w+) z=(-?[\d.]+) vz=(-?[\d.]+) period=(-?[\d.]+)ms");
        static readonly Regex RSoles = new Regex(@"WLREMOTE send soles=\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\) rtt=(-?[\d.]+)ms period=(-?[\d.]+)ms(?: status=(-?\d+))?(?: yaw=(-?[\d.]+))?");
        static readonly Regex RDev = new Regex(@"WLDEV|wl\.dev\.", RegexOptions.IgnoreCase);
        public LogTail(string p) { path = p; }
        static double D(string s) { return double.Parse(s, System.Globalization.CultureInfo.InvariantCulture); }
        public static double StampMsOf(string line)
        {
            Match m = RStamp.Match(line);
            if (!m.Success) return double.NaN;
            DateTime t = new DateTime(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value),
                int.Parse(m.Groups[4].Value), int.Parse(m.Groups[5].Value), int.Parse(m.Groups[6].Value), int.Parse(m.Groups[7].Value), DateTimeKind.Utc);
            return (t - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }
        public int Poll()
        {
            if (!File.Exists(path)) return 0;
            int before = S.Count;
            using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                if (fs.Length < pos) { pos = 0; carry.Length = 0; }
                fs.Seek(pos, SeekOrigin.Begin);
                byte[] buf = new byte[1 << 16];
                int n;
                char[] cbuf = new char[(1 << 16) + 8];
                while ((n = fs.Read(buf, 0, buf.Length)) > 0)
                {
                    pos += n;
                    int c = dec.GetChars(buf, 0, n, cbuf, 0);
                    for (int i = 0; i < c; i++)
                    {
                        char ch = cbuf[i];
                        if (ch == '\n') { Line(carry.ToString().TrimEnd('\r')); carry.Length = 0; }
                        else carry.Append(ch);
                    }
                }
            }
            return S.Count - before;
        }
        void Line(string ln)
        {
            Lines++;
            if (ln.IndexOf("WLDEV", StringComparison.Ordinal) >= 0 || ln.IndexOf("wl.dev.", StringComparison.OrdinalIgnoreCase) >= 0) { Dev++; LastDevLine = ln.Length > 200 ? ln.Substring(0, 200) : ln; }
            if (ln.IndexOf("WLREMOTE send ", StringComparison.Ordinal) < 0) return;
            Match m = RSend.Match(ln);
            if (m.Success)
            {
                double st = StampMsOf(ln);
                if (double.IsNaN(st)) return;
                if (any) g += D(m.Groups[4].Value) / 1000.0;
                any = true;
                Sample s = new Sample();
                s.StampMs = st; s.G = g; s.Motion = m.Groups[1].Value; s.Z = D(m.Groups[2].Value); s.Vz = D(m.Groups[3].Value); s.PeriodMs = D(m.Groups[4].Value);
                S.Add(s);
                Env = Math.Min(Env, st - g * 1000.0);
                if (S.Count > 4000) S.RemoveRange(0, 1000);
                return;
            }
            m = RSoles.Match(ln);
            if (m.Success && S.Count > 0 && !S[S.Count - 1].HasPos)
            {
                Sample s = S[S.Count - 1];
                s.X = D(m.Groups[1].Value); s.Y = D(m.Groups[2].Value); s.Sz = D(m.Groups[3].Value); s.HasPos = true;
                s.Yaw = m.Groups[7].Success ? D(m.Groups[7].Value) : double.NaN;
            }
        }
        /// <summary>wall-clock ms of a sample (game clock + running envelope)</summary>
        public double TimeOf(Sample s) { return s.G * 1000.0 + Env; }
    }

    public class Rect { public double X0, X1, Y0, Y1, Za, Zb; public string Axis = ""; }

    /// <summary>DRY RUN ONLY. Not the game: a kinematic model to exercise the drive's decisions offline.</summary>
    public class Sim
    {
        public double T = 0, X, Y, Z, Vz, CamYaw, CpdTrue, Ground0 = 10.0, NextReport = 50, Epoch;
        /// <summary>v3.1c: the ACTOR's yaw (what the sender logs as yaw=): it turns toward the camera only while W is held
        /// (bOrientRotationToMovement turns toward the input acceleration; none = no turn), at ActorTurnRate deg/s (v3.1d: the Dog's
        /// RotationRate yaw 260, RelayDogCharacter.cpp:713 at a82b2a5d; the drive sets it from -SimActorTurnRate); standing camera turns
        /// do not move it</summary>
        public double ActorYaw, ActorTurnRate = 260;
        public bool Air = false, W = false, Shift = false, JumpQueued = false, SpaceHeld = false;
        public readonly List<Rect> Terrain = new List<Rect>();
        public readonly List<Sample> S = new List<Sample>();
        int k = 0;
        double lastReportT = 0;
        static readonly double[] Periods = { 117, 165, 123, 141 };
        public Sim(double x, double y, double yaw, double cpdTrue, double epochMs) { X = x; Y = y; CamYaw = yaw; ActorYaw = yaw; CpdTrue = cpdTrue; Epoch = epochMs; Z = GroundAt(x, y); }
        public void AddRect(double x0, double x1, double y0, double y1, double za, double zb, string axis)
        { Rect r = new Rect(); r.X0 = x0; r.X1 = x1; r.Y0 = y0; r.Y1 = y1; r.Za = za; r.Zb = zb; r.Axis = axis ?? ""; Terrain.Add(r); }
        public double GroundAt(double x, double y)
        {
            for (int i = Terrain.Count - 1; i >= 0; i--)
            {
                Rect r = Terrain[i];
                if (x >= r.X0 && x < r.X1 && y >= r.Y0 && y < r.Y1)
                {
                    if (r.Axis == "y") return r.Za + (r.Zb - r.Za) * (y - r.Y0) / (r.Y1 - r.Y0);
                    if (r.Axis == "x") return r.Za + (r.Zb - r.Za) * (x - r.X0) / (r.X1 - r.X0);
                    return r.Za;
                }
            }
            return Ground0;
        }
        /// <summary>DRY RUN realism (v3.1e): W stays held this long after its release is sent (the game sees a hold ~19 ms longer:
        /// rehearsal 5's 60-ms probe taps turned the actor ~20.5 deg at 260 deg/s); 0 = the old exact hold</summary>
        public double KeyUpLagMs = 0;
        double wUpAt = -1;
        public void Key(string name, bool down)
        {
            if (name == "W") { if (down) { W = true; wUpAt = -1; } else if (KeyUpLagMs > 0) { wUpAt = T + KeyUpLagMs; } else { W = false; } }
            else if (name == "LSHIFT") Shift = down;
            else if (name == "SPACE") { if (down && !SpaceHeld) JumpQueued = true; SpaceHeld = down; }
        }
        /// <summary>DRY RUN fixture (v3.1b): after SwitchCounts counts of mouse movement the model's true counts/deg becomes Cpd2 (0 = never)</summary>
        public double Cpd2 = 0, SwitchCounts = 0;
        /// <summary>DRY RUN fixture (v3.1c): a NEGATIVE move uses counts/deg * CpdNegFactor (an input asymmetry); 1 = none</summary>
        public double CpdNegFactor = 1.0;
        /// <summary>DRY RUN realism (v3.1c): walk acceleration/braking in uu/s^2 (0 = the old instant speed)</summary>
        public double Accel = 0;
        double countsSoFar = 0, vNow = 0;
        public void Mouse(int dx)
        {
            countsSoFar += Math.Abs(dx);
            double c = (Cpd2 > 0 && countsSoFar > SwitchCounts) ? Cpd2 : CpdTrue;
            if (dx < 0) c *= CpdNegFactor;
            CamYaw += dx / c;
        }
        double Speed() { return W ? (Shift ? 520.0 : 230.0) : 0.0; }
        public void Advance(double ms)
        {
            double end = T + ms;
            while (T < end)
            {
                double dt = 0.005;
                if (wUpAt >= 0 && T >= wUpAt) { W = false; wUpAt = -1; }
                double sp = Speed();
                if (Accel > 0) { vNow = sp > vNow ? Math.Min(sp, vNow + Accel * dt) : Math.Max(sp, vNow - Accel * dt); sp = vNow; }
                if (W)      // v3.1d: CharacterMovement turns the actor toward the INPUT acceleration only (ComputeOrientToMovementRotation)
                {
                    double dy = CamYaw - ActorYaw; dy = dy - 360.0 * Math.Round(dy / 360.0);
                    double stepMax = ActorTurnRate * dt;
                    ActorYaw += Math.Max(-stepMax, Math.Min(stepMax, dy));
                }
                double a = CamYaw * Math.PI / 180.0;
                double nx = X + Math.Cos(a) * sp * dt, ny = Y + Math.Sin(a) * sp * dt;
                double gNew = GroundAt(nx, ny);
                // a wall: walking, a step up > MaxStepHeight 30; v3.1e: FALLING, any ground above the Dog (it cannot fall into a wall's top)
                if (Air ? gNew - Z > 0.0 : gNew - Z > 30.0) { nx = X; ny = Y; gNew = GroundAt(X, Y); }
                X = nx; Y = ny;
                if (JumpQueued && !Air) { Air = true; Vz = 420.0; }
                JumpQueued = false;
                // v3.1e: walking follows a step DOWN of up to MaxStepHeight 30 (CharacterMovement's floor sweep reaches MaxStepHeight); more = a fall
                if (!Air) { if (gNew < Z - 30.0) { Air = true; Vz = 0.0; } else Z = gNew; }
                if (Air)
                {
                    Vz -= 980.0 * dt; Z += Vz * dt;
                    if (Z <= gNew && Vz < 0) { Z = gNew; Vz = 0; Air = false; }
                }
                T += dt * 1000.0;
                if (T >= NextReport)
                {
                    Sample s = new Sample();
                    s.StampMs = Epoch + T; s.G = T / 1000.0; s.Z = Math.Round(Z * 10) / 10; s.Vz = Vz; s.PeriodMs = S.Count == 0 ? 0 : T - lastReportT;
                    lastReportT = T;
                    s.Motion = Air ? (Vz > 0 ? "JUMP" : "FALL") : (sp < 10 ? "IDLE" : (sp < 400 ? "WALK" : "RUN"));
                    s.X = Math.Round(X * 10) / 10; s.Y = Math.Round(Y * 10) / 10; s.Sz = s.Z; s.HasPos = true; s.Yaw = ActorYaw - 360.0 * Math.Round(ActorYaw / 360.0);   // the game logs -180..180
                    S.Add(s);
                    NextReport += Periods[k % 4]; k++;
                }
            }
        }
        /// <summary>DRY RUN: the model's reports in the client's exact WLREMOTE line formats (so b33_slicer.py can check the plan's classes)</summary>
        public void WriteLog(string path)
        {
            StringBuilder b = new StringBuilder();
            DateTime e = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            System.Globalization.CultureInfo ci = System.Globalization.CultureInfo.InvariantCulture;
            int n = 0;
            foreach (Sample s in S)
            {
                DateTime t = e.AddMilliseconds(Math.Floor(s.StampMs));
                string st = string.Format(ci, "[{0:yyyy.MM.dd-HH.mm.ss}:{1:000}][{2,3}]", t, t.Millisecond, n++ % 1000);
                b.Append(st).Append(string.Format(ci, "LogTemp: Display: WLREMOTE send motion={0} z={1:F1} vz={2:F1} period={3:F0}ms", s.Motion, s.Z, s.Vz, s.PeriodMs)).Append('\n');
                b.Append(st).Append(string.Format(ci, "LogTemp: Display: WLREMOTE send soles=({0:F1},{1:F1},{2:F1}) rtt=0ms period={3:F0}ms status=200 yaw={4:F2}", s.X, s.Y, s.Z, s.PeriodMs, s.Yaw)).Append('\n');
            }
            File.WriteAllText(path, b.ToString(), new UTF8Encoding(false));
        }
    }
}
