# b33_frames.ps1 -- W2DEV observer frame capture for B33 (M2 checklist B7). DIAGNOSTIC tool, W2DEV, not evidence by itself.
# What it does: while <Run>\frames\CAPTURE exists (b33_drive.ps1 creates it at each BLOCK_BEGIN and removes it at BLOCK_END), it copies the
#   OBSERVER window's client area from the screen at -Fps frames per second to <Run>\frames\f_<utc_ms>.jpg and appends "utc_ms,file,x,y,w,h" to
#   <Run>\frames\index.csv (UTC ms taken just before the copy). It raises the observer window TOPMOST without activating it (SWP_NOACTIVATE: no
#   focus change, so keys still go to the sender) while capturing, and restores it. It sends NO input. Exits when <Run>\frames\STOP exists, the
#   observer process ends, or -MaxFrames is reached. Physical pixels (PER_MONITOR_AWARE_V2); the client size is read every frame, never
#   assumed (the client ignores -ResX/-ResY; b33_launch.ps1 places the windows).
# Inputs : -Run <run folder>, -ObserverPids "<pid>[,<pid>]" (a comma string; the launcher passes the observer's GAME pid). Outputs: frames +
#          index.csv + frames.log.
# Limits : a screen copy shows whatever is on screen in that rectangle (a system flyout above a topmost window would be in the frame: look at
#          every frame before anything is kept); the figure's size depends on where the observer's camera points (unverified, see README).
param([Parameter(Mandatory)][string]$Run, [Parameter(Mandatory)][string]$ObserverPids, [double]$Fps = 5, [int]$Quality = 70, [int]$MaxFrames = 6000)
$ErrorActionPreference = 'Stop'
# a comma string, split here: through "powershell -File" an [int[]] argument "4,8" arrives as 48 (memory: Windows/PowerShell traps)
$ObserverPids = @($ObserverPids -split '[,; ]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })
Add-Type -Path (Join-Path $PSScriptRoot 'b33_native.cs')
Add-Type -AssemblyName System.Drawing
# physical pixels: the whole process PER_MONITOR_AWARE_V2 (as the launcher's placement), else system-aware; the rect itself is always read
# through a PER_MONITOR_AWARE_V2 thread context (b33_native.cs) so it matches RUN.json; the window's size is read every frame, never assumed
if (-not [B33.Win]::MakeProcessPerMonitorV2()) { [void][B33.Win]::SetProcessDPIAware() }
$dir = Join-Path $Run 'frames'; New-Item -ItemType Directory -Force $dir | Out-Null
$idx = Join-Path $dir 'index.csv'; $log = Join-Path $dir 'frames.log'
if (-not (Test-Path $idx)) { Set-Content -Path $idx -Value 'utc_ms,file,x,y,w,h' -Encoding ascii }
function Note([string]$t) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $t) -Encoding utf8 }
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
$hwnd = [IntPtr]::Zero; $top = $false; $n = 0
$period = [int](1000.0 / [Math]::Max(0.5, $Fps))
Note ("start: observer pids {0}, {1} fps, quality {2}" -f ($ObserverPids -join ' '), $Fps, $Quality)
try {
  while ($n -lt $MaxFrames) {
    if (Test-Path (Join-Path $dir 'STOP')) { Note 'STOP file'; break }
    $alive = @($ObserverPids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($alive.Count -eq 0) { Note 'observer ended'; break }
    if ($hwnd -eq [IntPtr]::Zero) { foreach ($id in $alive) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $p.MainWindowHandle } } }
    $t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ((Test-Path (Join-Path $dir 'CAPTURE')) -and $hwnd -ne [IntPtr]::Zero -and -not [B33.Win]::IsIconic($hwnd)) {
      if (-not $top) { [B33.Win]::Topmost($hwnd, $true); $top = $true; Note 'capture on (observer topmost, not activated)' }
      $r = [B33.Win]::ClientOnScreen($hwnd); $w = $r.R - $r.L; $h = $r.B - $r.T
      if ($w -gt 16 -and $h -gt 16) {
        $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try { $g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size($w, $h))) } finally { $g.Dispose() }
        $f = "f_$ms.jpg"
        $bmp.Save((Join-Path $dir $f), $codec, $ep); $bmp.Dispose()
        Add-Content -Path $idx -Value ("{0},{1},{2},{3},{4},{5}" -f $ms, $f, $r.L, $r.T, $w, $h) -Encoding ascii
        $n++
      }
    } elseif ($top) { [B33.Win]::Topmost($hwnd, $false); $top = $false; Note 'capture off' }
    $sleep = $period - ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $t0)
    Start-Sleep -Milliseconds ([int][Math]::Max(10, $sleep))
  }
} finally {
  if ($top -and $hwnd -ne [IntPtr]::Zero) { [B33.Win]::Topmost($hwnd, $false) }
  Note ("end: {0} frames" -f $n)
}
