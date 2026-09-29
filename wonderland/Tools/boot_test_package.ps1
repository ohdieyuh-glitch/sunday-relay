# Boot the PACKAGED Wonderland: does it load Golden Arrival, and does World Partition stream more than one cell?
param([string]$Exe = 'C:\dev\iwonder\_wonderland_package_20260929\Windows\Wonderland.exe',
      [string]$Out = 'C:\dev\iwonder\_wonderland_package_20260929\boot_test')
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WlBoot {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  public static IntPtr Largest(uint pid) {
    IntPtr best = IntPtr.Zero; long area = 0;
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      uint wp; GetWindowThreadProcessId(h, out wp);
      if (wp == pid && IsWindowVisible(h)) { RECT r; GetWindowRect(h, out r); long a = (long)(r.R - r.L) * (r.B - r.T); if (a > area) { area = a; best = h; } }
      return true; }, IntPtr.Zero);
    return best;
  }
}
'@
# the game process is found (and stopped) by the package folder the -Exe lives in; the first version hard-coded the
# 2026-09-29 folder, so any other package would boot, take no frame and be left running
$PkgDir = Split-Path (Split-Path $Exe -Parent) -Parent
New-Item -ItemType Directory -Force $Out | Out-Null
$args = '-windowed -ResX=1600 -ResY=900 -nosound -log -ExecCmds="wp.Runtime.ToggleDrawRuntimeHash2D"'
$p = Start-Process -FilePath $Exe -ArgumentList $args -PassThru
"launched bootstrap pid $($p.Id) at $(Get-Date -Format HH:mm:ss)"
Start-Sleep -Seconds 75
$game = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" }
$game | Select-Object Name, Id, @{n='PrivMB';e={[int]($_.PrivateMemorySize64/1MB)}} | Format-Table -AutoSize | Out-String
foreach ($g in $game) {
  $h = [WlBoot]::Largest([uint32]$g.Id)
  if ($h -ne [IntPtr]::Zero) {
    $r = New-Object WlBoot+RECT; [WlBoot]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.R - $r.L; $ht = $r.B - $r.T
    if ($w -gt 600) {
      $bmp = New-Object System.Drawing.Bitmap($w, $ht); $gr = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $gr.GetHdc()
      $ok = [WlBoot]::PrintWindow($h, $hdc, 2); $gr.ReleaseHdc($hdc); $gr.Dispose()
      $f = Join-Path $Out ("packaged_boot_{0}.png" -f $g.Id); $bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
      "frame $f printwindow=$ok ${w}x${ht}"
    }
  }
}
Start-Sleep -Seconds 2
Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" } | Stop-Process -Force
"stopped at $(Get-Date -Format HH:mm:ss)"
