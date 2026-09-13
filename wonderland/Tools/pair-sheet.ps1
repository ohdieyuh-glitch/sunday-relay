# Before/after pairs for named captures: <Folder>\<Name>__<BeforeTag>.png beside <Name>__<AfterTag>.png, one row per name.
param(
    [Parameter(Mandatory = $true)][string]$Folder,
    [Parameter(Mandatory = $true)][string[]]$Names,
    [Parameter(Mandatory = $true)][string]$BeforeTag,
    [Parameter(Mandatory = $true)][string]$AfterTag,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$ThumbWidth = 820
)
$names = $Names | ForEach-Object { $_ -split "," } | Where-Object { $_ }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("pairs_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory $tmp | Out-Null
$i = 0
foreach ($n in $names) {
    Copy-Item (Join-Path $Folder "$($n)__$BeforeTag.png") (Join-Path $tmp ("{0:D2}a_{1}__{2}.png" -f $i, $n, $BeforeTag))
    Copy-Item (Join-Path $Folder "$($n)__$AfterTag.png") (Join-Path $tmp ("{0:D2}b_{1}__{2}.png" -f $i, $n, $AfterTag))
    $i++
}
& (Join-Path $PSScriptRoot "contact-sheet.ps1") -Folder $tmp -Out $Out -Columns 2 -ThumbWidth $ThumbWidth | Out-Null
Remove-Item -Recurse -Force $tmp
"wrote $Out"
