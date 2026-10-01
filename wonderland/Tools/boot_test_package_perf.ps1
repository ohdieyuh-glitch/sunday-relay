# Boot the PACKAGED Wonderland and measure it: wl.Qa.Perf (one pass through every thing a player does) or
# wl.Qa.Soak N (N minutes of it on repeat, for memory growth, hangs and crashes).
#
# FOUNDER, 2026-09-30: "Measure the package, not just the editor ... Test on the founder's actual laptop first", and
# "Do not let local background watchers themselves distort the memory test." The game measures itself (WLPERF / WLSOAK
# lines: FPS, 1% low, hitches, memory, UObjects); this script adds what the game cannot see -- the process's working set,
# private bytes and dedicated GPU memory -- with ONE counter read every few seconds, and nothing else running.
param([Parameter(Mandatory = $true)][string]$Exe,
      [Parameter(Mandatory = $true)][string]$Out,
      [ValidateSet('perf', 'soak')][string]$Mode = 'perf',
      [int]$Minutes = 30,
      [int]$SampleSeconds = 5,
      [string]$UserDir = '')
$Root = Split-Path $Exe -Parent
$PkgDir = Split-Path $Root -Parent
New-Item -ItemType Directory -Force $Out | Out-Null
# ISOLATED: a fresh profile under the output folder, never a real player's %LOCALAPPDATA%\Wonderland (the soak changes skins
# and writes contracts).
if (-not $UserDir) { $UserDir = Join-Path $Out "userdir_$Mode" }
if (Test-Path $UserDir) { Remove-Item -Recurse -Force $UserDir }
New-Item -ItemType Directory -Force $UserDir | Out-Null
$UserDir = (Resolve-Path $UserDir).Path
$Saved = Join-Path $UserDir 'Saved'
$Log = Join-Path $Saved 'Logs\Wonderland.log'
$cmd = if ($Mode -eq 'perf') { 'wl.Qa.Perf' } else { "wl.Qa.Soak $Minutes" }
$limit = if ($Mode -eq 'perf') { 900 } else { $Minutes * 60 + 600 }
$csv = Join-Path $Out "process_$Mode.csv"
'seconds,working_set_mb,private_mb,gpu_dedicated_mb,machine_free_mb' | Set-Content -Encoding utf8 $csv

$t0 = Get-Date
$argList = '-windowed -ResX=1920 -ResY=1200 -nosound -log -userdir="' + $UserDir + '" -ExecCmds="' + $cmd + '"'
$p = Start-Process -FilePath $Exe -ArgumentList $argList -PassThru
"[$Mode] launched $($p.Id) at $(Get-Date -Format HH:mm:ss): $cmd (saved folder $Saved)"
Start-Sleep -Seconds 10
$deadline = (Get-Date).AddSeconds($limit)
while ((Get-Date) -lt $deadline) {
  $game = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" } | Sort-Object WorkingSet64 -Descending | Select-Object -First 1
  if (-not $game) { break }
  $gpu = 0
  try {
    $samples = (Get-Counter "\GPU Process Memory(pid_$($game.Id)_*)\Dedicated Usage" -ErrorAction Stop).CounterSamples
    $gpu = [math]::Round((($samples | Measure-Object CookedValue -Sum).Sum) / 1MB)
  } catch { $gpu = -1 }
  $os = Get-CimInstance Win32_OperatingSystem
  '{0},{1},{2},{3},{4}' -f [int]((Get-Date) - $t0).TotalSeconds, [math]::Round($game.WorkingSet64 / 1MB),
    [math]::Round($game.PrivateMemorySize64 / 1MB), $gpu, [math]::Round($os.FreePhysicalMemory / 1KB) | Add-Content -Encoding utf8 $csv
  Start-Sleep -Seconds $SampleSeconds
}
$left = Get-Process Wonderland* -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$PkgDir*" }
if ($left) { "[$Mode] TIMEOUT after $limit s: stopping $($left.Id -join ',')"; $left | Stop-Process -Force }
"[$Mode] game ended after $([int]((Get-Date) - $t0).TotalSeconds) s"
$found = Get-ChildItem $UserDir -Recurse -Filter 'Wonderland.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($found) { $Log = $found.FullName }
if (Test-Path $Log) {
  Copy-Item $Log (Join-Path $Out "Wonderland_$Mode.log") -Force
  $lines = Select-String -Path $Log -Pattern 'WLPERF|WLSOAK|WLBUILD|Fatal error|Assertion failed|Unhandled Exception' | ForEach-Object { $_.Line }
  $lines | Set-Content -Encoding utf8 (Join-Path $Out "wlperf_lines_$Mode.txt")
  $lines
} else { "[$Mode] NO LOG at $Log" }
$rows = Import-Csv $csv
if ($rows) {
  "process peak working set $(($rows | Measure-Object working_set_mb -Maximum).Maximum) MB, peak private $(($rows | Measure-Object private_mb -Maximum).Maximum) MB, peak dedicated GPU $(($rows | Measure-Object gpu_dedicated_mb -Maximum).Maximum) MB, lowest machine free $(($rows | Measure-Object machine_free_mb -Minimum).Minimum) MB over $($rows.Count) samples"
}
