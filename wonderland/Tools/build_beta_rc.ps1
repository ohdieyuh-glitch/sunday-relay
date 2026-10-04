# Build ONE Wonderland private-beta release candidate: the package another person receives and runs.
#
# FOUNDER, 2026-09-30: "The beta artifact must be something another person can actually receive and run" -- a clean
# packaged build, the right files and no others, no machine paths, no founder state, no private QA artefacts, a
# version visible in the game, minimal truthful instructions, and the size recorded. This script is that pipeline:
#
#   1. stamps BuildInfo/BuildInfo.txt ("Private Beta <version> | build <sha> | <date>"); the game shows it on the window
#      title, at the foot of the Menu and in its log (WonderlandBeta::BuildLabel);
#   2. BuildCookRun, Development (the in-package QA runs on the very artifact testers get) into a CLEAN archive folder,
#      WITH -prereqs (vc_redist installers) AND the Visual C++ runtime deployed app-local beside the game exe, so a PC
#      without the runtime still starts the game (B02);
#   3. copies the staged build to the release folder WITHOUT Saved/ (QA logs name this machine and its user, B16),
#      *.pdb (symbols stay with us, B28), RelaySkins/_reference and _previous (founder sheets and old generator source),
#      ProjectAvatars/_old, .gitignore files, the staging manifests (they name excluded files), and every
#      WorldDesign/Look record except practical_lights.json (the others carry founder commentary);
#   4. adds Engine/Build/InstalledProjectBuild.txt, which makes FApp::IsInstalled() true, so saves and logs live in
#      %LOCALAPPDATA%\Wonderland\Saved: they survive the next beta drop and work from a read-only folder (B12);
#   5. writes README_BETA.txt, zips the folder, records the file count, sizes and SHA-256 -- and FAILS if the
#      prerequisites are not in the artifact.
#
# Every log line is UTF-8 (Windows PowerShell 5.1 writes UTF-16 by default, which grep cannot read).
# Run it with the editor closed: .\build_beta_rc.ps1 -Version 0.1.0-rc2
param([Parameter(Mandatory = $true)][string]$Version,
      [string]$ArchiveDir = 'C:\dev\iwonder\_wonderland_beta_archive',
      [string]$ReleaseRoot = 'C:\dev\iwonder\_wonderland_beta_release',
      [string]$AppLocalRoot = 'C:\dev\iwonder\_wonderland_applocal',
      [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Project = Join-Path $ProjectDir 'Wonderland.uproject'
$UAT = 'C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\RunUAT.bat'
if (Get-Process UnrealEditor*, Wonderland* -ErrorAction SilentlyContinue) { throw 'Close the editor and any running Wonderland first.' }
New-Item -ItemType Directory -Force $ReleaseRoot | Out-Null
$Log = Join-Path $ReleaseRoot "build_$Version.log"
function Say([string]$Text) { $Text; $Text | Out-File -Append -Encoding utf8 $Log }
'' | Out-File -Encoding utf8 $Log

# 1. the build's name
$infoDir = Join-Path $ProjectDir 'BuildInfo'
$infoFile = Join-Path $infoDir 'BuildInfo.txt'
if ($SkipBuild) {
  # an old archive keeps the label it was built with: never stamp HEAD onto something HEAD did not build
  $label = (Get-Content -Raw (Join-Path $ArchiveDir 'Windows\Wonderland\BuildInfo\BuildInfo.txt')).Trim()
} else {
  $sha = (& git -C $ProjectDir rev-parse --short=8 HEAD).Trim()
  # TRACKED FILES ONLY: Content is the junction to the shared world tree and always reads as untracked here, which made
  # RC2's label say +local-changes for nothing. The world itself is fingerprinted by its map checkpoints, not by git.
  $dirty = (& git -C $ProjectDir status --porcelain --untracked-files=no -- Source Config RelaySkins UiArt Companions ProjectAvatars RelayCubs WorldDesign/Look) -join ''
  $suffix = if ($dirty) { '+local-changes' } else { '' }
  $label = "Private Beta $Version | build $sha$suffix | $(Get-Date -Format 'yyyy-MM-dd')"
  New-Item -ItemType Directory -Force $infoDir | Out-Null
  [IO.File]::WriteAllText($infoFile, $label, (New-Object Text.UTF8Encoding $false))
}
Say "BUILD LABEL $label"

try {
  if (-not $SkipBuild) {
    # 2a. the Visual C++ runtime, app-local: UAT stages every file under <root>\Win64\x64\<folder>\ beside the game exe
    $crt = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio\2022\*\VC\Redist\MSVC\*\x64\Microsoft.VC143.CRT' -Directory -ErrorAction SilentlyContinue |
      Sort-Object { [version]($_.Parent.Parent.Name) } -Descending | Select-Object -First 1
    if (-not $crt) { throw 'No Visual Studio 2022 VC143 CRT redistributable folder found for the app-local runtime.' }
    $crtDest = Join-Path $AppLocalRoot 'Win64\x64\Microsoft.VC143.CRT'
    if (Test-Path $AppLocalRoot) { Remove-Item -Recurse -Force $AppLocalRoot }
    New-Item -ItemType Directory -Force $crtDest | Out-Null
    Copy-Item (Join-Path $crt.FullName '*.dll') $crtDest
    Say "APPLOCAL CRT from $($crt.FullName)"

    # 2b. a clean archive: UAT -archive never removes files a previous build left
    if (Test-Path $ArchiveDir) { Remove-Item -Recurse -Force $ArchiveDir }
    $t0 = Get-Date
    & $UAT BuildCookRun "-project=$Project" -noP4 -platform=Win64 -clientconfig=Development -cook -build -stage -pak -archive "-archivedirectory=$ArchiveDir" -prereqs "-applocaldirectory=$AppLocalRoot" -utf8output -nocompileeditor 2>&1 | Out-File -Append -Encoding utf8 $Log
    if ($LASTEXITCODE -ne 0) { throw "BuildCookRun failed with exit code $LASTEXITCODE (see $Log)" }
    Say "BuildCookRun OK in $([int]((Get-Date) - $t0).TotalSeconds) s"
  }
} finally {
  # the tree stays clean: the label lives in the package, not in the source
  if (-not $SkipBuild) { Remove-Item $infoFile -ErrorAction SilentlyContinue }
}

# 3. the release folder: the staged build minus everything a tester must not receive
$src = Join-Path $ArchiveDir 'Windows'
if (-not (Test-Path (Join-Path $src 'Wonderland.exe'))) { throw "No staged build at $src" }
$name = "Wonderland_PrivateBeta_$Version"
$dst = Join-Path $ReleaseRoot $name
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
& robocopy $src $dst /E /XD Saved _reference _previous _old /XF *.pdb .gitignore Manifest_*.txt /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
$look = Join-Path $dst 'Wonderland\WorldDesign\Look'
if (Test-Path $look) { Get-ChildItem $look -File | Where-Object { $_.Name -ne 'practical_lights.json' } | Remove-Item -Force }
# AND THE ENGINE'S DEVELOPER TOOLS a DirectX 12 game never loads (Second Wonderland's RC2 audit): the Vulkan debugging
# layers (api_dump, validation, gfxreconstruct ...; about 40 MB, loaded only by a Vulkan debug session), the GPU dump
# viewer, and the ARM64 runtime installer beside an x64 build.
$vkLayers = Join-Path $dst 'Engine\Binaries\ThirdParty\Vulkan\Win64'
if (Test-Path $vkLayers) { Get-ChildItem $vkLayers -File | Where-Object { $_.Name -like 'VkLayer_*' } | Remove-Item -Force }
$gpuDump = Join-Path $dst 'Engine\Extras\GPUDumpViewer'
if (Test-Path $gpuDump) { Remove-Item -Recurse -Force $gpuDump }
$arm64 = Join-Path $dst 'Engine\Extras\Redist\en-us\vc_redist.arm64.exe'
if (Test-Path $arm64) { Remove-Item -Force $arm64 }
# AND THE RETIRED FIGURES (Second Wonderland's RC3 audit). The wardrobe offers the canonical five and nothing loads these,
# but a tester browsing the folder would meet designs the founder retired. The source files stay in the tree.
$retired = @('Apollo', 'ApolloV1', 'ApolloV2', 'ArdenInfernal', 'ArdenInfernalV1', 'ArdenInfernalV2', 'Bee', 'Hagoromo', 'SkeletonFlame', 'SkeletonFlameV1')
foreach ($stem in $retired) {
  $figure = Join-Path $dst "Wonderland\RelaySkins\$stem.wlvox"
  if (Test-Path $figure) { Remove-Item -Force $figure }
}
$cubDir = Join-Path $dst 'Wonderland\RelayCubs'
if (Test-Path $cubDir) { Get-ChildItem $cubDir -File | Where-Object { $_.Name -like 'CubGhost_Apollo_*' -or $_.Name -like 'CubGhost_ArdenInfernal_*' } | Remove-Item -Force }

# 4. an installed build: saves and logs go to %LOCALAPPDATA%\Wonderland\Saved
New-Item -ItemType Directory -Force (Join-Path $dst 'Engine\Build') | Out-Null
[IO.File]::WriteAllText((Join-Path $dst 'Engine\Build\InstalledProjectBuild.txt'), '', (New-Object Text.UTF8Encoding $false))

# 5. the instructions, kept short and true
$readme = @"
WONDERLAND - PRIVATE BETA $Version
$label

WHAT THIS IS
Wonderland is the 3D world of Relay. In this private beta you can explore the world, travel with the world map,
dress your Relay Dog in five skins and your own colours, write tasks as Mission Contracts, and watch a simulated
mission.

WHAT THIS BETA DOES NOT INCLUDE
- Julius and the AI companions are not connected in this build. Nothing in the beta calls an AI service.
  Tasks you write are saved on your PC as QUEUED Mission Contracts; the Missions panel (J) can play a SIMULATED
  mission so you can see how one unfolds.
- Friends, messages, parties and party voice live in the Social Hub: type /social in the agent terminal (Ctrl+T).
  They need a Wonderland social server and a GitHub sign-in. This build connects only when a server is set up for
  your test session; without one, the hub says "Social is not connected in this build" and nothing is sent.

REQUIREMENTS
- Windows 10 or 11, 64-bit
- 16 GB of RAM. Wonderland itself uses about 7 GB at EPIC quality.
- A DirectX 12 graphics card with at least 6 GB of video memory (8 GB recommended); Wonderland uses about 4 GB at EPIC.
- About 2 GB of free disk space
- Keyboard and mouse. Gamepads are not supported in this beta.

INSTALL AND RUN
1. Unzip the whole folder to a folder of its own that is not synced by OneDrive, for example C:\Games\Wonderland.
2. Double-click Wonderland.exe. The first start can take a minute.
3. The beta's files are not code-signed yet, so Windows may show "Windows protected your PC". Click "More info",
   then "Run anyway". If Windows says "The publisher could not be verified" instead, click Run.
   If Smart App Control is turned on, Windows blocks unsigned programs and offers no way to run them. Wonderland
   cannot start on that PC until the beta is signed; please tell us rather than turning Smart App Control off.
4. Windows may ask whether to allow Wonderland on public and private networks. Please click Cancel: nothing in
   Wonderland needs other computers to connect to it. The request comes from a diagnostics feature of the game
   engine, which this build switches off right after it starts. Wonderland connects out only after you sign in
   to social: to the social server, and to Epic Online Services for party voice.
5. If Windows reports a missing VCRUNTIME140.dll or MSVCP140.dll, run Engine\Extras\Redist\en-us\vc_redist.x64.exe
   once from this folder, then start Wonderland again.

CONTROLS
W A S D move, mouse look, Shift run, Ctrl walk, Space jump.
M          the world map: choose a place, then Teleport.
B          the Project Brain, and the wardrobe (Switch Skin).
J          Missions.        Ctrl+T   the agent terminals.        C   command presets.
/social    typed in the agent terminal: the Social Hub (friends, requests, recent players, messages, party, voice).
Esc / Tab  the menu: settings, colours, how to play, quit.

SETTINGS
Menu > SETTINGS: quality, window mode, resolution scale, frame-rate limit and hardware ray tracing.
If the world stutters, or your PC runs short of memory, lower QUALITY or RESOLUTION SCALE.
A laptop without a separate graphics card (integrated graphics only): choose QUALITY LOW before you explore. LOW
roughly halves the memory Wonderland uses.

GOOD TO KNOW
- Your skin, colours, settings, discovered places and Mission Contracts are saved on this PC.
- Jack Flame, Skeleton Flame and Baal have a FLAME colour of their own, in Menu > COLORS and in the Wardrobe; DEFAULT is
  the fire as designed.
- The Pixel Canvas in Wonder Web and the Project Brain's entries are samples. What you paint, and the changes you
  propose in the Project Brain, are kept until you quit, not saved.
- The WONDER WEB WALLET is a sandbox: its `$500.00 is not real money and nothing can be bought with it.
- The two companion terminals beside the agent terminal (Ctrl+T) are not connected in this beta. While you watch a
  simulated mission (J > WATCH A SIMULATED MISSION) they show the companions' part in it, marked SIMULATED: no AI
  is contacted and nothing is changed on your PC.
- If your Relay Dog ever disappears, press Esc, choose QUIT WONDERLAND, and start the game again.

YOUR SAVES AND LOG
%LOCALAPPDATA%\Wonderland\Saved      (paste it into the File Explorer address bar)
Logs\Wonderland.log there is the log of your last session.

REPORTING A PROBLEM
Say what you did and what happened, copy the build line from the bottom of the menu, and attach
%LOCALAPPDATA%\Wonderland\Saved\Logs\Wonderland.log. If the game crashed, also attach the newest folder in
%LOCALAPPDATA%\Wonderland\Saved\Crashes.
The log names your Windows user name and computer name, and shows folder paths that contain your user name. Open it
in Notepad first if you would rather replace those before you send it.

UNINSTALL
Delete this folder and %LOCALAPPDATA%\Wonderland.
"@
[IO.File]::WriteAllText((Join-Path $dst 'README_BETA.txt'), $readme.Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding $false))

# 6. the prerequisites MUST be in the artifact
$redist = Test-Path (Join-Path $dst 'Engine\Extras\Redist\en-us\vc_redist.x64.exe')
$appLocal = Test-Path (Join-Path $dst 'Wonderland\Binaries\Win64\vcruntime140.dll')
if (-not ($redist -and $appLocal)) { throw "Prerequisites missing from the release: vc_redist.x64.exe $redist, app-local vcruntime140.dll $appLocal" }

# 7. the zip, and the facts about it
$zip = Join-Path $ReleaseRoot "$name.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
& tar -a -c -f $zip -C $ReleaseRoot $name
if ($LASTEXITCODE -ne 0) { throw "zip failed with exit code $LASTEXITCODE" }
$files = Get-ChildItem -Recurse -File $dst
$folderBytes = ($files | Measure-Object Length -Sum).Sum
$hash = (Get-FileHash -Algorithm SHA256 $zip).Hash
$manifest = @(
  "release      $name",
  "label        $label",
  "commit       $(& git -C $ProjectDir rev-parse HEAD)",
  "files        $($files.Count)",
  "folder_bytes $folderBytes ($([math]::Round($folderBytes / 1GB, 2)) GB)",
  "zip          $zip",
  "zip_bytes    $((Get-Item $zip).Length) ($([math]::Round((Get-Item $zip).Length / 1GB, 2)) GB)",
  "zip_sha256   $hash",
  "prereqs      vc_redist.x64.exe staged; VC++ runtime app-local beside Wonderland\Binaries\Win64\Wonderland.exe",
  "excluded     Saved/, *.pdb, RelaySkins/_reference, RelaySkins/_previous, ProjectAvatars/_old, .gitignore, Manifest_*.txt, WorldDesign/Look records but practical_lights.json, Vulkan VkLayer_* debug layers, Engine/Extras/GPUDumpViewer, vc_redist.arm64.exe, retired figures (Apollo*, ArdenInfernal*, Bee, Hagoromo, SkeletonFlame, SkeletonFlameV1 and their cubs)",
  "installed    Engine/Build/InstalledProjectBuild.txt (saves and logs in %LOCALAPPDATA%\Wonderland\Saved)"
)
$manifest | Set-Content -Encoding utf8 (Join-Path $ReleaseRoot "RELEASE_MANIFEST_$Version.txt")
$manifest | ForEach-Object { Say $_ }
