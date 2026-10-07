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
      [switch]$SkipBuild, [switch]$SkipBuildIsNotEvidence, [switch]$GatesOnly)
$ErrorActionPreference = 'Stop'
# v4 (R3 m3): no GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE ... can redirect a git call of this build
Get-ChildItem env: | Where-Object { $_.Name -like 'GIT_*' } | ForEach-Object { Remove-Item "env:$($_.Name)" }
if ($SkipBuild -and -not $SkipBuildIsNotEvidence) { throw '-SkipBuild re-packs an existing archive: it is NOT evidence. Pass -SkipBuildIsNotEvidence as well to run it anyway.' }
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# v4 (R3 m3): the script running IS the project's Tools\build_beta_rc.ps1 (0a then proves that file is the committed one)
if ((Resolve-Path $PSCommandPath).Path -ne (Resolve-Path (Join-Path $ProjectDir 'Tools\build_beta_rc.ps1')).Path) { throw "Run the project's own Tools\build_beta_rc.ps1, not a copy ($PSCommandPath)" }
$Project = Join-Path $ProjectDir 'Wonderland.uproject'
$UAT = 'C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\RunUAT.bat'
if (Get-Process UnrealEditor*, Wonderland* -ErrorAction SilentlyContinue) { throw 'Close the editor and any running Wonderland first.' }
New-Item -ItemType Directory -Force $ReleaseRoot | Out-Null
$Log = Join-Path $ReleaseRoot "build_$Version.log"
function Say([string]$Text) { $Text; $Text | Out-File -Append -Encoding utf8 $Log }
'' | Out-File -Encoding utf8 $Log
# v3 (2026-10-07): ANY throw from here on is written into the build log before the script stops (reviewer 7: a 6b / 6c / git
# failure used to leave its reason in neither the build log nor the console log)
trap { Say "FAILED: $_"; break }

# 0. THE PRE-COOK GATES (v3, CORE's internal review round 2). Everything that can fail without a cook fails HERE, before the label
# and BuildInfo.txt are written (a failure between that write and the try/finally below would leave BuildInfo.txt in the tree, and
# the founder's editor would then show a build that never happened).
$engineRoot = Split-Path (Split-Path (Split-Path (Split-Path $UAT)))
$commitFull = (& git -C $ProjectDir rev-parse HEAD).Trim()
$gitTop = "$(& git -C $ProjectDir rev-parse --show-toplevel)".Trim().Replace('/', '\').TrimEnd('\')
if (-not $gitTop -or -not $ProjectDir.StartsWith($gitTop + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "git's toplevel '$gitTop' does not hold the project $ProjectDir" }
Say "BUILD COMMIT $commitFull"
# 0a. the Tools files that write SHIPPED bytes must be the ones in THIS commit (checked against the sha recorded now, not a later HEAD).
#     ls-tree is silent when a path is absent (no native stderr line, which ErrorActionPreference Stop would turn into a bare stop).
$blob = @{}
foreach ($t in 'Tools/WONDERLAND_BETA_EULA.txt', 'Tools/WONDERLAND_BETA_EULA.APPROVAL.txt', 'Tools/make_package_notices.py', 'Tools/build_beta_rc.ps1') {
  $inCommit = "$(& git -C $ProjectDir ls-tree --object-only $commitFull -- $t)".Trim()
  $here = "$(& git -C $ProjectDir hash-object -- $t)".Trim()
  if (-not $inCommit) { throw "$t is not in commit $commitFull" }
  if ($inCommit -ne $here) { throw "$t in the working tree ($here) is not the one in commit $commitFull ($inCommit)" }
  $blob[$t] = $inCommit
}
$python = (Get-Command python -ErrorAction Stop).Source
$noticesWork = Join-Path $ReleaseRoot "notices_$Version"
if (Test-Path $noticesWork) { Remove-Item -Recurse -Force $noticesWork }
New-Item -ItemType Directory -Force $noticesWork | Out-Null
# v4 (R3 M3): the build USES the committed bytes only. Each file is written out of the commit (git cat-file, raw bytes), checked
# against its blob id now, and again right before each use; the working tree is never read for them after this point.
$committed = Join-Path $noticesWork 'committed'
New-Item -ItemType Directory -Force $committed | Out-Null
function Get-CommittedCopy([string]$T) {
  $out = Join-Path $committed (Split-Path $T -Leaf)
  if (-not (Test-Path $out)) {
    $p = Start-Process -FilePath git -NoNewWindow -Wait -PassThru -ArgumentList '-C', "`"$ProjectDir`"", 'cat-file', 'blob', $blob[$T] -RedirectStandardOutput $out -RedirectStandardError "$out.err"
    if ($p.ExitCode -ne 0) { throw "git cat-file $($blob[$T]) ($T) exit $($p.ExitCode)" }
  }
  $now = "$(& git -C $ProjectDir hash-object -- $out)".Trim()
  if ($now -ne $blob[$T]) { throw "the committed copy of $T ($out) is $now, not the commit's $($blob[$T])" }
  return $out
}
$genCopy = Get-CommittedCopy 'Tools/make_package_notices.py'
$eulaCopy = Get-CommittedCopy 'Tools/WONDERLAND_BETA_EULA.txt'
$apprCopy = Get-CommittedCopy 'Tools/WONDERLAND_BETA_EULA.APPROVAL.txt'
Say "COMMITTED COPIES the generator, the EULA and its approval record, out of $commitFull into $committed"
# 0b. the notices generator's own selftest (its controls must behave before it judges anything)
$st = Start-Process -FilePath $python -NoNewWindow -Wait -PassThru -ArgumentList '-I', "`"$(Get-CommittedCopy 'Tools/make_package_notices.py')`"", '--selftest' `
  -RedirectStandardOutput (Join-Path $noticesWork 'selftest.txt') -RedirectStandardError (Join-Path $noticesWork 'selftest.err')
if ($st.ExitCode -ne 0) { throw "make_package_notices.py --selftest exit $($st.ExitCode) (see $noticesWork\selftest.txt)" }
Say "NOTICES generator selftest: $((Get-Content (Join-Path $noticesWork 'selftest.txt') | Select-Object -Last 1))"
# 0c. THE BETA EULA's parts (founder Decision 1): the SAME 9 phrases the static gate (core_final_static S14) requires, matched with
#     whitespace flattened, plus its ownership screen (R-1). It is checked again at 6c on the file actually written.
$EulaMust = @('END USER LICENSE AGREEMENT', 'LEGAL REVIEW REQUIRED', 'EPIC MAKES NO REPRESENTATIONS, WARRANTIES OR CONDITIONS',
              'DISCLAIM EVERY REPRESENTATION, WARRANTY, CONDITION AND LIABILITY', 'Epic is not responsible for Wonderland',
              'You may not extract any part of the Unreal Engine', 'THIRD_PARTY_NOTICES.txt', 'does not withdraw or narrow the rights',
              'does not itself state who holds those rights')
$copy = [string][char]0x00A9
# v4 (R3 M4): the SAME list as core_final_static.py's EULA_MUST_NOT (v3.3), matched on the FLATTENED text (every whitespace run,
# newlines and no-break spaces included, is one space)
$EulaMustNot = $copy + '|\(c\)\s*\d{4}|\bcopyright\s+(\d{4}|\(c\)|' + $copy + '|i\.wonder|ohdieyuh)|\bcopyright\s*:|all rights reserved|\bowned by\b|' +
               '\bis the (sole |exclusive )?owner\b|\b(i\.wonder|we)\s+(own|owns|retain|retains|reserve|reserves)\b|\bowns?\s+wonderland\b|' +
               '\breserves?\s+all\s+rights\b|\bproprietary (property )?(of|to) i\.wonder|\bproprietary\s+software\b|' +
               'all right,? title,? and interest|\bthe (sole |exclusive )?property of\b|\bintellectual property of\b|\bexclusive (owner|property)\b'
function Test-Eula([string]$Text, [string]$Where) {
  $flat = [regex]::Replace($Text, '[\s\u00A0\u2007\u202F\u2028\u2029]+', ' ')
  foreach ($m in $EulaMust) { if (-not $flat.Contains($m)) { throw "The Beta EULA ($Where) lost a required part: '$m'" } }
  $hit = [regex]::Match($flat, $EulaMustNot, 'IgnoreCase')
  if ($hit.Success) { throw "The Beta EULA ($Where) asserts ownership / copyright: '$($hit.Value)' (R-1 is open)" }
}
# v4 (R3 M4): THE PINNED BYTES. The approval record (committed, not shipped) names the sha256 of the EULA AS SHIPPED (UTF-8, CRLF:
# exactly what 6c writes) and its scope. A REHEARSAL scope pins the draft for rehearsals; only a FINAL scope (the founder's
# acceptance, recorded by a new commit) can ship a final package.
$appr = [IO.File]::ReadAllText($apprCopy)
$eulaPin = ([regex]::Match($appr, '(?m)^eula_sha256 ([0-9a-fA-F]{64})\s*$')).Groups[1].Value.ToUpperInvariant()
$eulaScope = ([regex]::Match($appr, '(?m)^scope (REHEARSAL|FINAL)\s*$')).Groups[1].Value
if (-not $eulaPin -or -not $eulaScope) { throw "The EULA approval record ($apprCopy) has no 'eula_sha256 <64 hex>' or 'scope REHEARSAL|FINAL' line" }
$eulaText = [IO.File]::ReadAllText($eulaCopy).Replace("`r`n", "`n")
Test-Eula $eulaText 'the committed text'
$eulaBytes = (New-Object Text.UTF8Encoding $false).GetBytes($eulaText.Replace("`n", "`r`n"))
$eulaSha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($eulaBytes)).Replace('-', '')
if ($eulaSha -ne $eulaPin) { throw "The Beta EULA's shipped bytes would be $eulaSha, not the approved $eulaPin (WONDERLAND_BETA_EULA.APPROVAL.txt)" }
# v4c (SECOND's review 52d4610c): DEFAULT-DENY. A REHEARSAL-scope record is allowed ONLY for an explicit rehearsal version
# (0.1.0-r16reh<n>[letter]); every other version -- 0.1.0, 0.1.0-beta, 0.1.0-rc<n>, anything new -- needs a FINAL-scope record.
if ($eulaScope -ne 'FINAL' -and $Version -notmatch '^0\.1\.0-r16reh\d+[a-z]?$') { throw "Version $Version needs a FINAL-scope EULA approval record (REHEARSAL is allowed only for 0.1.0-r16reh<n>[letter]); WONDERLAND_BETA_EULA.APPROVAL.txt at $commitFull says $eulaScope" }
Say "EULA the committed agreement has every required part, no ownership assertion, and its shipped bytes are the approved $($eulaPin.Substring(0, 12)) (scope $eulaScope)"
# 0d. THE THIRD-PARTY RECORDS FOR THIS GAME TARGET. UAT and UBT are single-instance per engine install; here, before the cook, a
#     collision with another lane's UAT / UBT costs seconds (fail fast; no mutex wait). UAT is called directly, not through
#     RunUAT.bat (cmd would take the '|' of -Target as a pipe); both tools write to files.
$tpsLog = Join-Path $noticesWork 'ListThirdPartySoftware.log'
$dotnet = Join-Path $engineRoot 'Engine\Binaries\ThirdParty\DotNet\10.0\win-x64\dotnet.exe'
$tps = Start-Process -FilePath $dotnet -WorkingDirectory (Join-Path $engineRoot 'Engine\Binaries\DotNET\AutomationTool') -NoNewWindow -Wait -PassThru `
  -ArgumentList 'AutomationTool.dll', 'ListThirdPartySoftware', "-Project=`"$Project`"", '-Target=Wonderland|Development|Win64' `
  -RedirectStandardOutput $tpsLog -RedirectStandardError "$tpsLog.err"
if ($tps.ExitCode -ne 0) { throw "ListThirdPartySoftware exit code $($tps.ExitCode) (see $tpsLog and $tpsLog.err)" }
Say "NOTICES the third-party records for this target are listed (before the cook): $tpsLog"
# v4: -GatesOnly runs the pre-cook gates (0a-0d) and stops BEFORE the label and BuildInfo.txt are written: a gate test, never a build
if ($GatesOnly) { Say 'GATES ONLY: every pre-cook gate passed; stopping before the label (nothing written into the tree)'; exit 0 }

# 1. the build's name
# v4b (SECOND 10-07): HEAD MUST STILL BE THE COMMIT STEP 0 RECORDED. Every later HEAD read (the label's short sha, the manifest's
# commit line) then names $commitFull; a worktree whose HEAD moved after 0a is refused, never labelled with another commit.
$headNow = (& git -C $ProjectDir rev-parse HEAD).Trim()
if ($headNow -ne $commitFull) { throw "HEAD moved after step 0: $commitFull -> $headNow (refusing to label or package a different commit)" }
$infoDir = Join-Path $ProjectDir 'BuildInfo'
$infoFile = Join-Path $infoDir 'BuildInfo.txt'
if ($SkipBuild) {
  # an old archive keeps the label it was built with: never stamp HEAD onto something HEAD did not build
  $label = (Get-Content -Raw (Join-Path $ArchiveDir 'Windows\Wonderland\BuildInfo\BuildInfo.txt')).Trim()
  # v3: the current tree's notices / EULA / README template go into this release, so the archive must be HEAD's own build, clean
  $headSha = (& git -C $ProjectDir rev-parse --short=8 HEAD).Trim()
  $skipDirty = (& git --no-optional-locks -C $ProjectDir status --porcelain --untracked-files=all -- Source Config RelaySkins UiArt Companions ProjectAvatars RelayCubs WorldDesign/Look Wonderland.uproject Tools/build_beta_rc.ps1 Tools/make_package_notices.py Tools/WONDERLAND_BETA_EULA.txt Tools/ThirdPartyLicenses) -join ''
  if ($label -notmatch "\| build $headSha \|" -or $skipDirty) { throw "-SkipBuild refused: the archive's label '$label' is not HEAD $headSha, or the tree is dirty" }
} else {
  $sha = (& git -C $ProjectDir rev-parse --short=8 HEAD).Trim()
  # TRACKED FILES ONLY: Content is the junction to the shared world tree and always reads as untracked here, which made
  # RC2's label say +local-changes for nothing. The world itself is fingerprinted by its map checkpoints, not by git.
  # 2026-10-07: lock-free (no index write into the shared .git during another lane's heavy window), and every path that produces
  # SHIPPED bytes counts: the uproject (its plugin list decides what ships) and the Tools files that write the README template,
  # the third-party notices and the Beta EULA.
  $dirty = (& git --no-optional-locks -C $ProjectDir status --porcelain --untracked-files=all -- Source Config RelaySkins UiArt Companions ProjectAvatars RelayCubs WorldDesign/Look Wonderland.uproject Tools/build_beta_rc.ps1 Tools/make_package_notices.py Tools/WONDERLAND_BETA_EULA.txt Tools/ThirdPartyLicenses) -join ''
  # v4b (SECOND 10-07): a dirty tree THROWS. Its '+local-changes' label was refused by every label check after the cook anyway.
  if ($dirty) { throw "The tree is dirty in the paths that produce shipped bytes; commit or restore them first:`n$($dirty -join "`n")" }
  $suffix = ''
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
# v4d, R12 (founder 2026-10-07: UNKNOWN never passes; an optional component whose licence is unresolved is REMOVED, never shipped).
# The R12 ledger's evidence: _wonderland_beta_release/r12_closure (sa2_files). Two Windows DLLs the engine stages go:
#  - dbghelp.dll 10.0.25291.1000: no SDK licence is established for that build (the engine's record names 10.0.19041). DBGHELP is
#    delay-loaded, so the system copy serves; the engine's preload of the bundled copy logs its failure and goes on.
#  - xaudio2_9redist.dll: its own licence (Microsoft.XAudio2.Redist) names no part of itself as distributable code. EOS voice uses
#    the system XAudio 2.9 (task3 WonderlandEosVoice.cpp), and the game's audio links the system xaudio2.lib (XAudio2_9.Build.cs).
$dbghelpDir = Join-Path $dst 'Engine\Binaries\ThirdParty\DbgHelp'
if (Test-Path $dbghelpDir) { Remove-Item -Recurse -Force $dbghelpDir }
$xaudioRedistDir = Join-Path $dst 'Engine\Binaries\ThirdParty\Windows\XAudio2_9'
if (Test-Path $xaudioRedistDir) { Remove-Item -Recurse -Force $xaudioRedistDir }
# AND THE VC++ REDISTRIBUTABLE is Microsoft's own download, not the engine's copy: the VS 2022 licence's Distributable List covers the
# packages obtained from Microsoft's download pages; the engine's 14.50.35719 bundle (from the UE install) carries no grant. The root
# bootstrap needs a runtime >= 14.50.35719 (the app-local DLLs are 14.44), so the installer must stay. Pinned by sha256: aka.ms/vc14/
# vc_redist.x64.exe, 14.51.36247.0, Authenticode "Microsoft Corporation" (Code Signing PCA 2024), fetched 2026-10-07.
$VcRedistPinned = 'C:\dev\iwonder\_wonderland_beta_release\vendor\vc_redist.x64_14.51.36247.0.exe'
$VcRedistSha256 = '843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C'
if (-not (Test-Path $VcRedistPinned) -or (Get-FileHash $VcRedistPinned -Algorithm SHA256).Hash -ne $VcRedistSha256) { throw "the pinned vc_redist.x64.exe ($VcRedistPinned) is missing or is not $VcRedistSha256" }
$vcRedistDst = Join-Path $dst 'Engine\Extras\Redist\en-us\vc_redist.x64.exe'
Copy-Item -Force $VcRedistPinned $vcRedistDst
# AND THE RETIRED FIGURES (Second Wonderland's RC3 audit). The wardrobe offers the canonical five and nothing loads these,
# but a tester browsing the folder would meet designs the founder retired. The source files stay in the tree.
$retired = @('Apollo', 'ApolloV1', 'ApolloV2', 'ArdenInfernal', 'ArdenInfernalV1', 'ArdenInfernalV2', 'Bee', 'Hagoromo', 'SkeletonFlame', 'SkeletonFlameV1')
foreach ($stem in $retired) {
  $figure = Join-Path $dst "Wonderland\RelaySkins\$stem.wlvox"
  if (Test-Path $figure) { Remove-Item -Force $figure }
}
$cubDir = Join-Path $dst 'Wonderland\RelayCubs'
if (Test-Path $cubDir) { Get-ChildItem $cubDir -File | Where-Object { $_.Name -like 'CubGhost_Apollo_*' -or $_.Name -like 'CubGhost_ArdenInfernal_*' } | Remove-Item -Force }
# AND THE SOCIAL PREVIEW'S SYNTHETIC PEOPLE (Second Wonderland's final-package audit, 10-06). A player session never loads them (the
# founder, 10-02: "Do not expose synthetic users to beta testers as though they are real people"); only a -wldev developer session
# does, and no shipped launch surface carries -wldev. So the player package does not carry the made-up friends at all.
$socialPreview = Join-Path $dst 'Wonderland\UiArt\Social'
if (Test-Path $socialPreview) { Get-ChildItem $socialPreview -File | Where-Object { $_.Name -like 'social-preview*.json' } | Remove-Item -Force }

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
  your test session; without one, pressing SIGN IN in the hub tells you social is not connected in this build, and
  nothing is sent.

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
B          the Project Brain; in its C.A.R.D. section, the visual_mods tile opens MASCOT & VISUAL MODS,
           with OPEN WARDROBE.
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
# v4d (R12): the installer is the PINNED Microsoft download, and the two removed DLLs are really gone
if ((Get-FileHash (Join-Path $dst 'Engine\Extras\Redist\en-us\vc_redist.x64.exe') -Algorithm SHA256).Hash -ne $VcRedistSha256) { throw "vc_redist.x64.exe in the release is not the pinned Microsoft download $VcRedistSha256" }
$leftovers = @(Get-ChildItem -Recurse -File $dst | Where-Object { $_.Name -in @('dbghelp.dll', 'xaudio2_9redist.dll') } | ForEach-Object { $_.FullName.Substring($dst.Length + 1) })
if ($leftovers.Count) { throw "R12: the release still carries a removed DLL: $($leftovers -join ', ')" }

# 6b. THE THIRD-PARTY NOTICES (founder ruling 2026-10-07: "Preserve third-party software/license obligations independently of the
# project-level proprietary license"). The package redistributes BSD (Ogg/Vorbis), MIT (MsQuic), Apache-2.0 (oneTBB),
# font and vendor binaries; Epic's staged NOTICES.txt carries one FreeType line. The Unreal Engine EULA's Third Party Software
# clause names Engine/Source/ThirdParty/Licenses as where those terms live. UAT lists every third-party record for THIS game
# target (step 1b, before the cook); make_package_notices.py builds THIRD_PARTY_NOTICES.txt from them and FAILS the build if any
# redistributed binary, font or certificate bundle in the package, loose or packed in the pak (the staged UFS manifest), maps to
# no record with license terms (exit 1 = a GAP; exit 2 = an ERROR, never mistaken for a gap).
$ufsManifest = Join-Path $src 'Manifest_UFSFiles_Win64.txt'
if (-not (Test-Path $ufsManifest)) { Say "FAILED: no UFS manifest at $ufsManifest (the files packed in the pak cannot be judged)"; throw "No UFS manifest at $ufsManifest" }
# v4 (R3 m4): an empty or truncated manifest would judge nothing packed: it must look like the staged pak's own list
$ufsLines = @(Get-Content $ufsManifest | Where-Object { $_.Trim() })
foreach ($anchor in 'Engine/Content/Certificates/ThirdParty/cacert.pem', 'Engine/Content/Internationalization/icudt', 'Engine/Config/BaseEngine.ini') {
  if (-not @($ufsLines | Where-Object { $_.StartsWith($anchor) }).Count) { throw "The UFS manifest $ufsManifest has no '$anchor' entry: not a whole list" }
}
if ($ufsLines.Count -lt 1000) { throw "The UFS manifest $ufsManifest lists only $($ufsLines.Count) files (< 1000): not a whole list" }
$noticesOut = Join-Path $noticesWork 'out'
$gen = Start-Process -FilePath $python -NoNewWindow -Wait -PassThru `
  -ArgumentList '-I', "`"$(Get-CommittedCopy 'Tools/make_package_notices.py')`"", '--tps-log', "`"$tpsLog`"", '--engine', "`"$engineRoot`"", '--out', "`"$noticesOut`"", '--shipped', "`"$dst`"", '--ufs-manifest', "`"$ufsManifest`"", '--texts', "`"$(Join-Path $ProjectDir 'Tools\ThirdPartyLicenses')`"" `
  -RedirectStandardOutput (Join-Path $noticesWork 'make_package_notices.txt') -RedirectStandardError (Join-Path $noticesWork 'make_package_notices.err')
$genOut = @(Get-Content (Join-Path $noticesWork 'make_package_notices.txt') -Encoding UTF8)
$genOut | Select-Object -First 2 | ForEach-Object { Say "NOTICES $_" }
$genOut | Where-Object { $_ -match '^\s*GAP\s|^ERROR' } | ForEach-Object { Say "NOTICES $_" }
Get-Content (Join-Path $noticesWork 'make_package_notices.err') -Tail 5 -ErrorAction SilentlyContinue | Where-Object { $_ } | ForEach-Object { Say "NOTICES stderr: $_" }
$gapsLine = $genOut | Where-Object { $_ -match '^GAPS: (\d+)$' } | Select-Object -Last 1
if ($gen.ExitCode -eq 1 -and $gapsLine -and [int]([regex]::Match($gapsLine, '\d+').Value) -gt 0) { throw "THIRD_PARTY_NOTICES: a redistributed file maps to no third-party record with license terms ($gapsLine; see $noticesWork)" }
if ($gen.ExitCode -ne 0) { throw "THIRD_PARTY_NOTICES: the generator failed (exit $($gen.ExitCode): an ERROR, not a gap; see $noticesWork)" }
Copy-Item (Join-Path $noticesOut 'THIRD_PARTY_NOTICES.txt') (Join-Path $dst 'THIRD_PARTY_NOTICES.txt')
Say "NOTICES THIRD_PARTY_NOTICES.txt written: every redistributed binary, font and certificate bundle mapped, loose and packed (GAPS 0)"

# 6c. THE BETA END USER LICENSE AGREEMENT (founder Decision 1, 2026-10-07T11:41Z: "add a dedicated end-user agreement to the
# distributed package. Do NOT rely only on README wording"). The Unreal Engine EULA's Section 4(c) lets end users use the engine
# in a distributed product only "pursuant to an end user license agreement that explicitly disclaims any representations,
# warranties, conditions, and liabilities related to the Licensed Technology". A DRAFT: legal review is required before any wider
# or public distribution (WONDERLAND_BETA_EULA.REVIEW_NOTES.md, not shipped). Copied verbatim with Windows line endings; the build
# FAILS if the file is missing or has lost the Epic disclaimer, the third-party pointer or the no-revocation sentence.
# v4 (R3 M3 / M4): THE COMMITTED COPY ONLY (re-verified against its blob id here), written with CRLF, then PINNED
$eula = [IO.File]::ReadAllText((Get-CommittedCopy 'Tools/WONDERLAND_BETA_EULA.txt')).Replace("`r`n", "`n")
Test-Eula $eula 'the text to write'
[IO.File]::WriteAllText((Join-Path $dst 'WONDERLAND_BETA_EULA.txt'), $eula.Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding $false))
Test-Eula ([IO.File]::ReadAllText((Join-Path $dst 'WONDERLAND_BETA_EULA.txt'))) 'the file written into the package'
$writtenSha = (Get-FileHash -Algorithm SHA256 (Join-Path $dst 'WONDERLAND_BETA_EULA.txt')).Hash
if ($writtenSha -ne $eulaPin) { throw "WONDERLAND_BETA_EULA.txt as written is $writtenSha, not the approved $eulaPin" }
Say "EULA WONDERLAND_BETA_EULA.txt written, = the approved bytes $($eulaPin.Substring(0, 12)) (scope $eulaScope; draft: legal review required before wider or public distribution)"

# 7. the zip, and the facts about it
# v4b (SECOND 10-07): the cook took an hour or more; the manifest's commit line reads HEAD, so HEAD must STILL be $commitFull
$headNow = (& git -C $ProjectDir rev-parse HEAD).Trim()
if ($headNow -ne $commitFull) { throw "HEAD moved during the build: $commitFull -> $headNow (the package is NOT evidence of either commit)" }
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
  "excluded     Saved/, *.pdb, RelaySkins/_reference, RelaySkins/_previous, ProjectAvatars/_old, .gitignore, Manifest_*.txt, WorldDesign/Look records but practical_lights.json, Vulkan VkLayer_* debug layers, Engine/Extras/GPUDumpViewer, vc_redist.arm64.exe, retired figures (Apollo*, ArdenInfernal*, Bee, Hagoromo, SkeletonFlame, SkeletonFlameV1 and their cubs), UiArt/Social/social-preview*.json (the developer preview's synthetic people)",
  "installed    Engine/Build/InstalledProjectBuild.txt (saves and logs in %LOCALAPPDATA%\Wonderland\Saved)",
  "notices      THIRD_PARTY_NOTICES.txt (from the engine's third-party records for this target: make_package_notices.py, GAPS 0) beside Epic's NOTICES.txt",
  "eula         WONDERLAND_BETA_EULA.txt (the private-Beta end user license agreement; DRAFT, legal review required before wider or public distribution)",
  "notices_sha256 $((Get-FileHash -Algorithm SHA256 (Join-Path $dst 'THIRD_PARTY_NOTICES.txt')).Hash)",
  "eula_scope   $eulaScope (WONDERLAND_BETA_EULA.APPROVAL.txt at $commitFull)",
  "skip_build   $(if ($SkipBuild) { 'yes: an existing archive re-packed, NOT EVIDENCE' } else { 'no' })",
  "eula_sha256  $((Get-FileHash -Algorithm SHA256 (Join-Path $dst 'WONDERLAND_BETA_EULA.txt')).Hash)",
  "tps_log_sha256 $((Get-FileHash -Algorithm SHA256 $tpsLog).Hash)"
)
$manifest | Set-Content -Encoding utf8 (Join-Path $ReleaseRoot "RELEASE_MANIFEST_$Version.txt")
$manifest | ForEach-Object { Say $_ }
