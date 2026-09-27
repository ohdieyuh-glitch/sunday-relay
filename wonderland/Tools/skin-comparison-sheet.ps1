# REFERENCE / OLD / REBUILD, ONE SHEET PER SKIN -- the comparison set the founder asked for on 2026-09-27.
#
# Left column: the founder's own reference sheet (RelaySkins\_reference\<Skin>_founder_sheet.png). Middle: the
# skin as it was before the rebuild, off the same wardrobe stage (captures\zc\before_rebuild_2026-09-27\ or the
# offline render when no stage export exists). Right: the six stage views zc_skin_sheet exported after the
# rebuild, laid out FRONT / 3-4 FRONT / LEFT / 3-4 BACK / BACK / RIGHT.
#
#   powershell -File wonderland\Tools\skin-comparison-sheet.ps1 -Skin skeleton_flame -Stem SkeletonFlame -Out <png>
param(
    [Parameter(Mandatory = $true)][string]$Skin,
    [Parameter(Mandatory = $true)][string]$Stem,
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$Root = (Join-Path $PSScriptRoot ".."),
    [int]$Cell = 420
)
Add-Type -AssemblyName System.Drawing
$reference = Join-Path $Root ("RelaySkins\_reference\" + $Stem + "_founder_sheet.png")
$oldDir = Join-Path $Root "Tools\captures\zc\before_rebuild_2026-09-27"
$newDir = Join-Path $Root "Tools\captures\zc\skin_sheet"
$views = @("front", "front34", "left", "back34", "back", "right")

function Load($path) {
    if (Test-Path $path) { return [System.Drawing.Image]::FromFile($path) }
    return $null
}
function Fit($g, $img, $x, $y, $w, $h) {
    if ($null -eq $img) { return }
    $scale = [Math]::Min($w / $img.Width, $h / $img.Height)
    $dw = [int]($img.Width * $scale); $dh = [int]($img.Height * $scale)
    $g.DrawImage($img, $x + [int](($w - $dw) / 2), $y + [int](($h - $dh) / 2), $dw, $dh)
}

$label = 30
$refW = [int]($Cell * 1.6)
$sheetW = $refW + $Cell + 3 * $Cell + 4 * 8
$sheetH = 2 * ($Cell + $label) + 3 * 8 + $label
$sheet = New-Object System.Drawing.Bitmap $sheetW, $sheetH
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::FromArgb(20, 22, 28))
$font = New-Object System.Drawing.Font "Segoe UI", 13, ([System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(236, 214, 160))
$g.DrawString(("{0}  --  REFERENCE | OLD (2026-09-27 morning) | REBUILD (six wardrobe views)" -f $Stem), $font, $brush, 8, 4)

# reference, full height on the left
$y0 = $label + 8
Fit $g (Load $reference) 8 $y0 $refW (2 * ($Cell + $label) + 8)
$g.DrawString("REFERENCE", $font, $brush, 8, $y0 + 2 * ($Cell + $label) + 8 - $label)

# old: the offline front render and the noon in-world capture, stacked
$x = $refW + 16
$oldFront = Load (Join-Path $oldDir ("offline_old\" + $Stem + "_front.png"))
$oldWorld = Load (Join-Path $oldDir ("h12.0_" + $Skin + ".png"))
Fit $g $oldFront $x $y0 $Cell $Cell
$g.DrawString("OLD front (offline)", $font, $brush, $x, $y0 + $Cell + 2)
Fit $g $oldWorld $x ($y0 + $Cell + $label + 8) $Cell $Cell
$g.DrawString("OLD in world, noon", $font, $brush, $x, $y0 + 2 * $Cell + $label + 10)

# rebuild: six views, 3 x 2
$x0 = $x + $Cell + 8
for ($i = 0; $i -lt $views.Count; $i++) {
    $col = $i % 3; $row = [int][Math]::Floor($i / 3)
    $vx = $x0 + $col * ($Cell + 8); $vy = $y0 + $row * ($Cell + $label + 8)
    $img = Load (Join-Path $newDir ($Skin + "__" + $views[$i] + ".png"))
    Fit $g $img $vx $vy $Cell $Cell
    $g.DrawString(("REBUILD " + $views[$i]), $font, $brush, $vx, $vy + $Cell + 2)
    if ($img) { $img.Dispose() }
}
$sheet.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $sheet.Dispose()
Write-Output ("wrote " + $Out)
