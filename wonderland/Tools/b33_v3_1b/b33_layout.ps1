# b33_layout.ps1 -- pure window-layout helpers (no Win32 calls) dot-sourced by b33_launch.ps1 and b33_drive.ps1. DIAGNOSTIC tool, W2DEV, not evidence by itself.
# Why: the packaged clients IGNORE -ResX/-ResY (lead, B35 v4 shakedown 10-20: client areas came up 1600x1000 whatever -ResX said), so the
# launcher PLACES both game windows itself (SetWindowPos from a PER_MONITOR_AWARE_V2 thread, b33_native.cs Win.Place), re-reads them, and the
# drive refuses to start unless the re-read rectangles match the targets/RUN.json within 2 px and do not overlap. All rectangles are physical
# pixels: [pscustomobject]@{ left; top; right; bottom } (right/bottom exclusive, as Win32 RECT).
# Tested by tests\test_drive_and_stop.ps1 (L1-L4).
function New-Rect([int]$l, [int]$t, [int]$r, [int]$b) { return [pscustomobject]@{ left = $l; top = $t; right = $r; bottom = $b } }
function ConvertTo-Rect($rc) { return New-Rect $rc.L $rc.T $rc.R $rc.B }          # from a B33.Win+RC struct
function ConvertFrom-JsonRect($j) { if ($null -eq $j) { return $null }; return New-Rect ([int]$j.left) ([int]$j.top) ([int]$j.right) ([int]$j.bottom) }
function Format-Rect($a) { if ($null -eq $a) { return 'none' }; return ('({0},{1})-({2},{3}) {4}x{5}' -f $a.left, $a.top, $a.right, $a.bottom, ($a.right - $a.left), ($a.bottom - $a.top)) }
function Test-RectNear($a, $b, [int]$tol = 2) {
  # every edge within tol pixels
  if ($null -eq $a -or $null -eq $b) { return $false }
  return ([Math]::Abs($a.left - $b.left) -le $tol -and [Math]::Abs($a.top - $b.top) -le $tol -and
          [Math]::Abs($a.right - $b.right) -le $tol -and [Math]::Abs($a.bottom - $b.bottom) -le $tol)
}
function Test-RectOverlap($a, $b) {
  # true if the two rectangles share any pixel (touching edges do not overlap: right/bottom are exclusive)
  return ($a.left -lt $b.right) -and ($b.left -lt $a.right) -and ($a.top -lt $b.bottom) -and ($b.top -lt $a.bottom)
}
function Test-RectUsable($a, [int]$minW = 320, [int]$minH = 240) { return ($null -ne $a) -and (($a.right - $a.left) -ge $minW) -and (($a.bottom - $a.top) -ge $minH) }
function Test-PointInRect($r, [int]$x, [int]$y) {
  # REHEARSAL PATCH P1: is a screen point inside a rectangle (right/bottom exclusive, as Win32 RECT and ClipCursor)?
  if ($null -eq $r) { return $false }
  return ($x -ge $r.left -and $x -lt $r.right -and $y -ge $r.top -and $y -lt $r.bottom)
}
function Get-ClipAction($clip, [int]$x, [int]$y) {
  # REHEARSAL PATCH P1 (lead 10-20, B35 rehearsal: the FOREGROUND game clips the cursor to its own client rect): before the cursor jumps to
  # (x, y): 'release' if the current clip (GetClipCursor) does not contain the point (then ClipCursor(NULL) and verify), else 'none'. The
  # decision uses only the clip and the point, never the virtual-desktop metrics.
  if (Test-PointInRect $clip $x $y) { return 'none' }
  return 'release'
}
function Get-ClientPoint($c, [double]$xp, [double]$yp) {
  # a point inside a client rectangle at xp/yp percent (physical pixels)
  return [pscustomobject]@{ x = [int]($c.left + [Math]::Floor(($c.right - $c.left) * $xp / 100.0)); y = [int]($c.top + [Math]::Floor(($c.bottom - $c.top) * $yp / 100.0)) }
}
function Get-LayoutTargets([int]$frameW, [int]$frameH, [int]$frameY, [int]$senderX, [int]$observerX) {
  return [pscustomobject]@{ sender = (New-Rect $senderX $frameY ($senderX + $frameW) ($frameY + $frameH)); observer = (New-Rect $observerX $frameY ($observerX + $frameW) ($frameY + $frameH)) }
}
function Test-Layout($targets, $sFrame, $oFrame, $sClient, $oClient, [int]$tol = 2) {
  # -> list of reasons (empty = OK): each frame within tol px of its target, frames and client areas do not overlap, client areas usable
  $why = @()
  if (-not (Test-RectNear $sFrame $targets.sender $tol)) { $why += ('sender frame {0} is not within {1} px of the target {2}' -f (Format-Rect $sFrame), $tol, (Format-Rect $targets.sender)) }
  if (-not (Test-RectNear $oFrame $targets.observer $tol)) { $why += ('observer frame {0} is not within {1} px of the target {2}' -f (Format-Rect $oFrame), $tol, (Format-Rect $targets.observer)) }
  if ($sFrame -and $oFrame -and (Test-RectOverlap $sFrame $oFrame)) { $why += ('the frames overlap: {0} and {1}' -f (Format-Rect $sFrame), (Format-Rect $oFrame)) }
  if ($sClient -and $oClient -and (Test-RectOverlap $sClient $oClient)) { $why += ('the client areas overlap: {0} and {1}' -f (Format-Rect $sClient), (Format-Rect $oClient)) }
  if (-not (Test-RectUsable $sClient)) { $why += ('sender client area unusable: {0}' -f (Format-Rect $sClient)) }
  if (-not (Test-RectUsable $oClient)) { $why += ('observer client area unusable: {0}' -f (Format-Rect $oClient)) }
  return , $why
}
