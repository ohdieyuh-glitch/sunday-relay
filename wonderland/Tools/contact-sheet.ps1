param(
    [Parameter(Mandatory = $true)][string]$Folder,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Columns = 4,
    [int]$ThumbWidth = 640,
    [string]$Filter = "*.png",
    [int]$Skip = 0,
    [int]$Take = 1000
)
Add-Type -AssemblyName System.Drawing
$files = @(Get-ChildItem -Path $Folder -Filter $Filter | Sort-Object Name | Select-Object -Skip $Skip -First $Take)
if ($files.Count -eq 0) { throw "no images in $Folder" }
$first = [System.Drawing.Image]::FromFile($files[0].FullName)
$thumbHeight = [int]([double]$ThumbWidth * $first.Height / $first.Width)
$first.Dispose()
$label = 26
$rows = [int][Math]::Ceiling($files.Count / $Columns)
$sheet = New-Object System.Drawing.Bitmap ($Columns * $ThumbWidth), ($rows * ($thumbHeight + $label))
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::FromArgb(20, 22, 28))
$font = New-Object System.Drawing.Font "Segoe UI", 12, ([System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(236, 214, 160))
for ($i = 0; $i -lt $files.Count; $i++) {
    $img = [System.Drawing.Image]::FromFile($files[$i].FullName)
    $x = ($i % $Columns) * $ThumbWidth
    $y = [int][Math]::Floor($i / $Columns) * ($thumbHeight + $label)
    $g.DrawString($files[$i].BaseName, $font, $brush, ($x + 6), ($y + 3))
    $g.DrawImage($img, $x, ($y + $label), $ThumbWidth, $thumbHeight)
    $img.Dispose()
}
$g.Dispose()
$sheet.Save($Out, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$sheet.Dispose()
"sheet $Out ($($files.Count) images, $Columns x $rows)"
