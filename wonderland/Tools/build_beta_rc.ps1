# Build ONE Wonderland private-beta release candidate: the package another person receives and runs.
#
# FOUNDER, 2026-09-30: "The beta artifact must be something another person can actually receive and run" -- a clean
# packaged build, the right files and no others, no machine paths, no founder state, no private QA artefacts, a
# version visible in the game, minimal truthful instructions, and the size recorded. This script is that pipeline:
#
#   1. stamps BuildInfo/BuildInfo.txt ("Private Beta <version> | build <sha> | <date>"); the game shows it on the window
#      title, at the foot of the Menu and in its log (WonderlandBeta::BuildLabel);
#   2. BuildCookRun, Development (the in-package QA runs on the very artifact testers get), WITH -prereqs so the
#      Visual C++ runtime installer ships (B02);
#   3. copies the staged build to the release folder WITHOUT Saved/ (QA logs name this machine and its user, B16),
#      *.pdb (symbols stay with us, B28), RelaySkins/_reference and _previous (founder sheets and old generator source),
#      ProjectAvatars/_old and .gitignore files;
#   4. adds Engine/Build/InstalledProjectBuild.txt, which makes FApp::IsInstalled() true, so saves and logs live in
#      %LOCALAPPDATA%\Wonderland\Saved: they survive the next beta drop and work from a read-only folder (B12);
#   5. writes README_BETA.txt, zips the folder, and records the file count, sizes and SHA-256.
#
# Run it with the editor closed: .\build_beta_rc.ps1 -Version 0.1.0-rc1
param([Parameter(Mandatory = $true)][string]$Version,
      [string]$ArchiveDir = 'C:\dev\iwonder\_wonderland_beta_archive',
      [string]$ReleaseRoot = 'C:\dev\iwonder\_wonderland_beta_release',
      [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Project = Join-Path $ProjectDir 'Wonderland.uproject'
$UAT = 'C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\RunUAT.bat'
if (Get-Process UnrealEditor*, Wonderland* -ErrorAction SilentlyContinue) { throw 'Close the editor and any running Wonderland first.' }
New-Item -ItemType Directory -Force $ReleaseRoot | Out-Null
$Log = Join-Path $ReleaseRoot "build_$Version.log"

# 1. the build's name
$sha = (& git -C $ProjectDir rev-parse --short=8 HEAD).Trim()
$dirty = (& git -C $ProjectDir status --porcelain -- Source Config) -join ''
$suffix = if ($dirty) { '+local-changes' } else { '' }
$label = "Private Beta $Version | build $sha$suffix | $(Get-Date -Format 'yyyy-MM-dd')"
$infoDir = Join-Path $ProjectDir 'BuildInfo'
New-Item -ItemType Directory -Force $infoDir | Out-Null
$infoFile = Join-Path $infoDir 'BuildInfo.txt'
[IO.File]::WriteAllText($infoFile, $label, (New-Object Text.UTF8Encoding $false))
"BUILD LABEL $label" | Tee-Object -FilePath $Log

try {
  # 2. build, cook, stage, pak, archive -- with the prerequisites installer
  if (-not $SkipBuild) {
    $t0 = Get-Date
    & $UAT BuildCookRun "-project=$Project" -noP4 -platform=Win64 -clientconfig=Development -cook -build -stage -pak -archive "-archivedirectory=$ArchiveDir" -prereqs -utf8output -nocompileeditor *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "BuildCookRun failed with exit code $LASTEXITCODE (see $Log)" }
    "BuildCookRun OK in $([int]((Get-Date) - $t0).TotalSeconds) s" | Tee-Object -FilePath $Log -Append
  }
} finally {
  # the tree stays clean: the label lives in the package, not in the source
  Remove-Item $infoFile -ErrorAction SilentlyContinue
}

# 3. the release folder: the staged build minus everything a tester must not receive
$src = Join-Path $ArchiveDir 'Windows'
if (-not (Test-Path (Join-Path $src 'Wonderland.exe'))) { throw "No staged build at $src" }
$name = "Wonderland_PrivateBeta_$Version"
$dst = Join-Path $ReleaseRoot $name
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
& robocopy $src $dst /E /XD Saved _reference _previous _old /XF *.pdb .gitignore /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

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
- Wonderland is single-player for now.

REQUIREMENTS
- Windows 10 or 11, 64-bit
- A DirectX 12 graphics card; 8 GB of video memory recommended
- 16 GB of RAM recommended
- About 2 GB of free disk space

INSTALL AND RUN
1. Unzip the whole folder somewhere you can write to, for example your Desktop or Documents.
2. Double-click Wonderland.exe.
3. The first start may install the Microsoft Visual C++ runtime, and can take a minute.
4. Windows may ask whether to allow Wonderland on public and private networks. The beta does not need the network;
   you can click Cancel. (The engine opens a developer diagnostics port that this build cannot switch off.)

CONTROLS
W A S D move, mouse look, Shift run, Ctrl walk, Space jump.
M          the world map: choose a place, then Teleport.
B          the Project Brain, and the wardrobe (Switch Skin).
J          Missions.        Ctrl+T   the agent terminals.        C   command presets.
Esc / Tab  the menu: settings, colours, how to play, quit.

SETTINGS
Menu > SETTINGS: quality, window mode, resolution scale, frame-rate limit and hardware ray tracing.
If the world stutters, or your PC runs short of memory, lower QUALITY or RESOLUTION SCALE.

YOUR SAVES AND LOG
%LOCALAPPDATA%\Wonderland\Saved      (paste it into the File Explorer address bar)
Logs\Wonderland.log there is the log of your last session.

REPORTING A PROBLEM
Say what you did and what happened, copy the build line from the bottom of the menu, and attach
%LOCALAPPDATA%\Wonderland\Saved\Logs\Wonderland.log.

UNINSTALL
Delete this folder and %LOCALAPPDATA%\Wonderland.
"@
[IO.File]::WriteAllText((Join-Path $dst 'README_BETA.txt'), $readme.Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding $false))

# 6. the zip, and the facts about it
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
  "prereqs      $(if (Test-Path (Join-Path $dst 'Engine\Extras\Redist\en-us\UEPrereqSetup_x64.exe')) { 'UEPrereqSetup_x64.exe staged' } else { 'MISSING' })",
  "excluded     Saved/, *.pdb, RelaySkins/_reference, RelaySkins/_previous, ProjectAvatars/_old, .gitignore",
  "installed    Engine/Build/InstalledProjectBuild.txt (saves and logs in %LOCALAPPDATA%\Wonderland\Saved)"
)
$manifest | Set-Content -Encoding utf8 (Join-Path $ReleaseRoot "RELEASE_MANIFEST_$Version.txt")
$manifest | Tee-Object -FilePath $Log -Append
