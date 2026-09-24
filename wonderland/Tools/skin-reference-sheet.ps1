# REFERENCE BESIDE THE ENGINE, which is the only way these skins get judged now.
#
# FOUNDER (2026-09-23): "Do not visually evaluate these skins from memory. REFERENCE IMAGE NEXT TO IN-ENGINE
# RENDER." and the row he wants is REFERENCE | FRONT | 3/4 | SIDE | REAR | MEDIUM DISTANCE. Building that by hand
# each round is how a round gets skipped, so it is a tool.
#
# The reference plate is portrait and the engine frames are 2:1 landscape, so the plate is fitted into the row
# height with its aspect kept -- a squashed reference is worse than no reference, because it makes the in-engine
# proportions look wrong in the comparison rather than in the game.
param(
    [Parameter(Mandatory = $true)][string]$Skin,          # e.g. apollo -- the in-engine capture prefix
    [Parameter(Mandatory = $true)][string]$Reference,     # the founder's plate for this skin
    [Parameter(Mandatory = $true)][string]$CaptureDir,    # where <skin>_front.jpg etc. live
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$RowHeight = 620
)
Add-Type -AssemblyName System.Drawing

$views = @('front', 'three_quarter', 'side', 'rear', 'medium_distance')
$frames = @()
foreach ($v in $views) {
    $p = Join-Path $CaptureDir ("{0}_{1}.jpg" -f $Skin, $v)
    if (-not (Test-Path $p)) { throw "missing in-engine view: $p" }
    $frames += [PSCustomObject]@{ Label = $v.ToUpper().Replace('_', ' '); Path = $p }
}
if (-not (Test-Path $Reference)) { throw "missing reference plate: $Reference" }

$label = 30
# the reference column is as wide as its own aspect makes it at this row height
$ref = [System.Drawing.Image]::FromFile($Reference)
$refW = [int]([double]$RowHeight * $ref.Width / $ref.Height)
$first = [System.Drawing.Image]::FromFile($frames[0].Path)
$frameW = [int]([double]$RowHeight * $first.Width / $first.Height)
$first.Dispose()

$totalW = $refW + ($frameW * $frames.Count)
$sheet = New-Object System.Drawing.Bitmap $totalW, ($RowHeight + $label)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::FromArgb(16, 17, 22))
$font = New-Object System.Drawing.Font 'Segoe UI', 13, ([System.Drawing.FontStyle]::Bold)
$gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(236, 214, 160))
$cyan = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(140, 226, 214))

$g.DrawString(("REFERENCE - " + $Skin.ToUpper()), $font, $gold, 8, 6)
$g.DrawImage($ref, 0, $label, $refW, $RowHeight)
$ref.Dispose()

$x = $refW
foreach ($f in $frames) {
    $img = [System.Drawing.Image]::FromFile($f.Path)
    $g.DrawString(("IN-ENGINE " + $f.Label), $font, $cyan, ($x + 8), 6)
    $g.DrawImage($img, $x, $label, $frameW, $RowHeight)
    $img.Dispose()
    $x += $frameW
}
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 74, 86)), 2
$g.DrawLine($pen, $refW, 0, $refW, ($RowHeight + $label))
$g.Dispose()
$sheet.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
Write-Output ("reference sheet {0} ({1} views beside the plate)" -f $Out, $frames.Count)
