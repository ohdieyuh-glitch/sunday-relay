# CURRENT WONDERLAND vs THE WONDERLAND BIBLE, side by side.
# Puts a capture on the left and the named Bible board panels (WorldDesign/Reference/bible_panels.json) stacked
# on the right, each labelled, so a pass is judged against the visual authority rather than from memory.
#   bible-compare.ps1 -Capture shot.png -Panels hero_b1,skyline_b4 -Out compare.jpg
param(
    [Parameter(Mandatory = $true)][string]$Capture,
    [Parameter(Mandatory = $true)][string[]]$Panels,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Width = 1100
)
Add-Type -AssemblyName System.Drawing
$spec = Get-Content (Join-Path $PSScriptRoot "..\WorldDesign\Reference\bible_panels.json") -Raw | ConvertFrom-Json
$shot = [System.Drawing.Image]::FromFile((Resolve-Path $Capture))
$shotH = [int]($Width * $shot.Height / $shot.Width)
$panelW = [int]($Width * 0.8)
$panelImgs = @()
$panelsH = 0
foreach ($name in ($Panels | ForEach-Object { $_ -split "," } | Where-Object { $_ })) {
    $p = $spec.panels.$name
    if ($null -eq $p) { throw "unknown Bible panel '$name'" }
    $board = [System.Drawing.Image]::FromFile((Join-Path $spec.boards_dir $p.board))
    $r = $p.rect
    $h = [int]($panelW * $r[3] / $r[2])
    $panelImgs += ,@($board, $r, $h, $name, $p.shows)
    $panelsH += $h + 26
}
$H = [Math]::Max($shotH + 26, $panelsH)
$sheet = New-Object System.Drawing.Bitmap ($Width + $panelW + 12), $H
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = "HighQualityBicubic"
$g.Clear([System.Drawing.Color]::FromArgb(22, 22, 28))
$font = New-Object System.Drawing.Font "Segoe UI", 11, ([System.Drawing.FontStyle]::Bold)
$g.DrawString("CURRENT WONDERLAND  " + [IO.Path]::GetFileNameWithoutExtension($Capture), $font, [System.Drawing.Brushes]::White, 6, 4)
$g.DrawImage($shot, (New-Object System.Drawing.Rectangle 0, 26, $Width, $shotH))
$y = 0
foreach ($item in $panelImgs) {
    $board, $r, $h, $name, $shows = $item
    $g.DrawString("WONDERLAND BIBLE  $name : $shows", $font, [System.Drawing.Brushes]::Gold, ($Width + 16), ($y + 4))
    $src = New-Object System.Drawing.Rectangle $r[0], $r[1], $r[2], $r[3]
    $g.DrawImage($board, (New-Object System.Drawing.Rectangle ($Width + 12), ($y + 26), $panelW, $h), $src, [System.Drawing.GraphicsUnit]::Pixel)
    $y += $h + 26
    $board.Dispose()
}
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 88L
$sheet.Save($Out, $enc, $ep)
$g.Dispose(); $sheet.Dispose(); $shot.Dispose()
"wrote $Out"
