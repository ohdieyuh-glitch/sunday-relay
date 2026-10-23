# J1 probe NO-KEY DRY RUN (doc 99bb84b6). FOUNDER-RUN ON KAISIN. Save as a file and run:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\j1_probe_nokey_dryrun_99bb84b6.ps1
# Expected success: probe exit 3 with "probe_key_file_missing" (stage=key_lookup) => DRY RUN PASS (exit 0). No key, no network call to xAI.
# Exit codes: 0 = DRY RUN PASS, 1 = DRY RUN FAIL (probe ran but did not stop cleanly at key_lookup), 2 = DRYRUN ABORT (refused or unexpected error; probe not judged).
# Evidence: <parent of -CloneDir>\julius-j1-dryrun-evidence\<yyyyMMdd-HHmmss>\dryrun_summary.json (default C:\dev\julius-j1-dryrun-evidence\...).
# GitHub sign-in: the private-repo clone/fetch uses your SAVED Git Credential Manager sign-in. Prompts are disabled for this run
#   (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never, this process only); with no saved sign-in it stops with DRYRUN ABORT (exit 2) instead of prompting.
param([string]$CloneDir = 'C:\dev\julius-j1-probe', [string]$RepoUrl = 'https://github.com/ohdieyuh-glitch/sunday-relay.git')
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
function Redact([string]$s) { if ($null -eq $s) { return $s }; return [regex]::Replace($s, '(?i)\b([a-z][a-z0-9+.\-]*://)[^/@\s]+@', '$1***@') }
function Abort([string]$m) { [Console]::Error.WriteLine('DRYRUN ABORT: ' + (Redact $m)); exit 2 }
trap { [Console]::Error.WriteLine('DRYRUN ABORT: unexpected error: ' + (Redact ([string]$_))); exit 2 }
$DocCommit = '99bb84b6faaf20d8c363cd01be05534a67519e38'; $DocPath = 'j1_receipts_options_20261023.md'; $DocBranch = 'docs/julius-j1-receipt-options-20261023'
$DocBlob = '35931304beaca1e592b09d2fdebfff360a935b13'; $DocSha256 = '3a7833120965bdf38a35572d837a474518350c4a754f844a659d18c7cf851bce'
$ScriptSha256Bom = 'a67eff3ab80fbab596e83634f1aa7eef2ee6ba794819d24ee4e3d94cc047be50'
$PinCommit = '31bfc58b89de137670e5dbaf752c3328b31163f7'; $PinBranch = 'judev/j1-combined-ceiling'
$SentinelName = 'julius-j1-dryrun-clone.json'; $SentinelKind = 'julius-j1-nokey-dryrun-clone/v1'
$sha = [Security.Cryptography.SHA256]::Create()
function Hex([byte[]]$b) { return (($sha.ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) -join '') }
function HexStr([string]$s) { return (Hex ((New-Object Text.UTF8Encoding $false).GetBytes($s))) }
Write-Host 'WILL: check env for provider keys (names only), make a NEW separate clone (or reuse one THIS block made, proven by its sentinel) at' $CloneDir
Write-Host '      of' (Redact $RepoUrl) 'checked out at pin 31bfc58b, extract the probe script from doc commit 99bb84b6, verify its sha256,'
Write-Host '      run it with an EMPTY key dir, report where it stopped.'
Write-Host 'WILL NOT: read/prompt for any API key, call xAI, fetch into or check out any existing checkout it did not create (incl. the protected'
Write-Host '      sunday-relay checkout), prompt for a GitHub sign-in, edit git config, push anything.'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) { Write-Warning ('Not Windows PowerShell 5.1 Desktop (' + $PSVersionTable.PSVersion + '); the probe itself is still run with Windows PowerShell 5.1.') }
# 1. Provider keys must not be set at ANY level (names + levels printed, never values)
$hits = @()
foreach ($lvl in 'Process', 'User', 'Machine') {
  $vars = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]$lvl)
  foreach ($n in @($vars.Keys)) { if ([string]$n -match '(?i)XAI|OPENAI|ANTHROPIC|OPENROUTER|_API_KEY$|_TOKEN$') { $hits += ($lvl + ':' + $n) } }
  foreach ($n in 'XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY') { if ([Environment]::GetEnvironmentVariable($n, [EnvironmentVariableTarget]$lvl)) { $hits += ($lvl + ':' + $n) } }
}
$hits = @($hits | Sort-Object -Unique)
if ($hits.Count -gt 0) { Abort ('provider key/token variables are set (unset them first): ' + ($hits -join ', ')) }
# 2. Clone target: real local path, outside every OneDrive folder, enough disk
$cloneFull = [IO.Path]::GetFullPath($CloneDir); $cloneCmp = $cloneFull.Replace('\', '/').TrimEnd('/')
foreach ($od in 'OneDrive', 'OneDriveCommercial', 'OneDriveConsumer') {
  $v = [Environment]::GetEnvironmentVariable($od); if ([string]::IsNullOrEmpty($v)) { continue }
  $o = [IO.Path]::GetFullPath($v).Replace('\', '/').TrimEnd('/')
  if ([string]::Equals($cloneCmp, $o, [StringComparison]::OrdinalIgnoreCase) -or $cloneCmp.StartsWith($o + '/', [StringComparison]::OrdinalIgnoreCase)) { Abort ('clone dir is under $env:' + $od) }
}
$freeGb = [math]::Floor((New-Object IO.DriveInfo([IO.Path]::GetPathRoot($cloneFull))).AvailableFreeSpace / 1GB)
if ($freeGb -lt 5) { Abort ('less than 5 GB free on ' + [IO.Path]::GetPathRoot($cloneFull) + ' (' + $freeGb + ' GB)') }
# 3. git = the binary (no alias/function), git env overrides cleared and prompts disabled for THIS process only
if (@(Get-Command git -CommandType Alias, Function, Filter, Cmdlet -ErrorAction SilentlyContinue).Count -gt 0) { Abort 'git is shadowed by an alias/function' }
$git = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
foreach ($gv in 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM') { Remove-Item -LiteralPath ('Env:' + $gv) -ErrorAction SilentlyContinue }
$env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
$AuthRx = '(?i)could not read (Username|Password)|terminal prompts disabled|Authentication failed|user interactivity has been disabled|Cannot prompt|Access denied|Invalid username or password|Repository not found|\b40[13]\b'
function Invoke-G([string[]]$a, [switch]$Net) {
  $p = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $o = @(& $git @a 2>&1 | ForEach-Object { [string]$_ }); $c = $LASTEXITCODE } finally { $ErrorActionPreference = $p }
  if ($c -ne 0) {
    if ($Net -and (($o -join "`n") -match $AuthRx)) { Abort ('GitHub sign-in needed: git could not authenticate to ' + $RepoUrl + ' and prompts are disabled for this run. In a normal PowerShell window run once:  git ls-remote ' + $RepoUrl + '  and finish the Git Credential Manager sign-in, then rerun this block. (git exit ' + $c + ': ' + ($o -join ' / ') + ')') }
    Abort ('git ' + ($a -join ' ') + ' failed (' + $c + '): ' + ($o -join ' / '))
  }
  return ,$o
}
# 4. Separate full (non-shallow) clone. An existing dir is reused ONLY if it holds the sentinel this block wrote at its first clone;
#    every other non-empty dir is refused BEFORE any git command runs in it (never fetch into / check out someone else's checkout).
$sentinel = Join-Path (Join-Path $cloneFull '.git') $SentinelName; $reused = $false
if (Test-Path -LiteralPath $cloneFull) {
  if (-not (Test-Path -LiteralPath $cloneFull -PathType Container)) { Abort ($cloneFull + ' exists and is not a directory; pick another -CloneDir') }
  if (@(Get-ChildItem -LiteralPath $cloneFull -Force).Count -gt 0) {
    if (-not ((Test-Path -LiteralPath (Join-Path $cloneFull '.git') -PathType Container) -and (Test-Path -LiteralPath $sentinel -PathType Leaf))) { Abort ($cloneFull + ' exists, is not empty and was not created by this dry-run block (no sentinel); it was NOT touched. Pick an empty or new -CloneDir') }
    $sj = $null; try { $sj = Get-Content -LiteralPath $sentinel -Raw | ConvertFrom-Json } catch { Abort ('sentinel unreadable: ' + $sentinel + '; dir NOT touched') }
    if ([string]$sj.kind -ne $SentinelKind) { Abort ('sentinel kind mismatch in ' + $sentinel + '; dir NOT touched') }
    if (-not [string]::Equals([string]$sj.clone_dir, $cloneFull, [StringComparison]::OrdinalIgnoreCase)) { Abort ('sentinel was written for a different dir (' + [string]$sj.clone_dir + '); dir NOT touched') }
    if ([string]$sj.repo_url_sha256 -ne (HexStr $RepoUrl)) { Abort ('sentinel was written for a different remote (' + [string]$sj.repo_url_redacted + '); dir NOT touched') }
    $url = (Invoke-G @('-C', $cloneFull, 'remote', 'get-url', 'origin'))[0]; if ($url -ne $RepoUrl) { Abort ($cloneFull + ' is a clone of a different remote: ' + $url) }
    $reused = $true
  }
}
if (-not $reused) {
  [void](Invoke-G @('clone', '-q', '--no-checkout', '--single-branch', '--branch', $PinBranch, $RepoUrl, $cloneFull) -Net)
  $sm = [ordered]@{ kind = $SentinelKind; clone_dir = $cloneFull; repo_url_redacted = (Redact $RepoUrl); repo_url_sha256 = (HexStr $RepoUrl); pinned_commit = $PinCommit; doc_commit = $DocCommit; created_utc = (Get-Date).ToUniversalTime().ToString('o') }
  $sm | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $sentinel
}
[void](Invoke-G @('-C', $cloneFull, 'fetch', '-q', 'origin', ('+refs/heads/' + $PinBranch + ':refs/remotes/origin/' + $PinBranch), ('+refs/heads/' + $DocBranch + ':refs/remotes/origin/' + $DocBranch)) -Net)
[void](Invoke-G @('-C', $cloneFull, 'checkout', '-q', '--detach', $PinCommit))
# 5. Extract the probe script from the doc AT 99bb84b6 (raw blob bytes) and verify hashes BEFORE running anything
$blobId = (Invoke-G @('-C', $cloneFull, 'rev-parse', '--verify', ($DocCommit + ':' + $DocPath)))[0].Trim()
if ($blobId -ne $DocBlob) { Abort ('doc blob mismatch: ' + $blobId) }
$psi = New-Object Diagnostics.ProcessStartInfo $git; $psi.Arguments = '-C "' + $cloneFull + '" cat-file blob ' + $blobId
$psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$proc = [Diagnostics.Process]::Start($psi); $ms = New-Object IO.MemoryStream; $proc.StandardOutput.BaseStream.CopyTo($ms); [void]$proc.StandardError.ReadToEnd(); $proc.WaitForExit()
if ($proc.ExitCode -ne 0) { Abort 'git cat-file failed' }
$docBytes = $ms.ToArray()
if ((Hex $docBytes) -ne $DocSha256) { Abort 'doc sha256 mismatch' }
$lines = (New-Object Text.UTF8Encoding $false).GetString($docBytes).Split("`n")
$start = [Array]::IndexOf($lines, '```powershell'); if ($start -lt 0) { Abort 'script block not found' }
$end = [Array]::IndexOf($lines, '```', $start + 1); if ($end -lt 0) { Abort 'script block end not found' }
$body = [string]::Join("`n", $lines[($start + 1)..($end - 1)])
[byte[]]$scriptBytes = [byte[]](0xEF, 0xBB, 0xBF) + (New-Object Text.UTF8Encoding $false).GetBytes($body)
$scriptHash = Hex $scriptBytes
if ($scriptHash -ne $ScriptSha256Bom) { Abort ('probe script sha256 mismatch: ' + $scriptHash) }
# 6. Run the UNMODIFIED probe with an EMPTY key dir and a dummy key-file name: it must stop at the key lookup
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('j1-dryrun-' + $stamp); $keyDir = Join-Path $tmp 'EMPTY-NO-KEY'
try {
  New-Item -ItemType Directory -Path $keyDir | Out-Null
  $scriptPath = Join-Path $tmp 'j1-xai-probe.ps1'; [IO.File]::WriteAllBytes($scriptPath, $scriptBytes)
  $evDir = Join-Path (Join-Path (Split-Path $cloneFull -Parent) 'julius-j1-dryrun-evidence') $stamp; New-Item -ItemType Directory -Path $evDir -Force | Out-Null
  $home2 = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  $before = @(Get-ChildItem -LiteralPath $home2 -Directory -Filter 'julius-xai-probe-*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  $psExe = if ($env:OS -eq 'Windows_NT') { Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' } else { Join-Path $PSHOME 'pwsh' }
  $env:JULIUS_J1_REPO_DIR = $cloneFull; $env:JULIUS_J1_KEY_DIR = $keyDir; $env:JULIUS_J1_REVIEWER_KEY_ENV = 'NO_KEY_DRY_RUN'; $env:JULIUS_J1_REVIEWER_MODEL = 'dry-run-no-call'
  if (@(Get-ChildItem -LiteralPath $keyDir -Force).Count -ne 0) { Abort 'key dir not empty' }
  $ErrorActionPreference = 'Continue'
  $out = @(& $psExe -NoProfile -ExecutionPolicy Bypass -File $scriptPath 2>&1 | ForEach-Object { [string]$_ }); $exitCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  $keyDirAfter = @(Get-ChildItem -LiteralPath $keyDir -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
$after = @(Get-ChildItem -LiteralPath $home2 -Directory -Filter 'julius-xai-probe-*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
$newOut = @($after | Where-Object { $before -notcontains $_ })
$refusal = @($out | Where-Object { $_ -match 'PROBE REFUSED: (.+)$' } | ForEach-Object { [regex]::Match($_, 'PROBE REFUSED: (.+)$').Groups[1].Value }) | Select-Object -First 1
# Stage ladder of the probe: env (line 5) < gate (B-3 checks) < key_lookup (Test-Path key file) < past_key_lookup (key file opened, network step)
$stage = if ($refusal -eq 'probe_key_file_missing') { 'key_lookup' } elseif ($exitCode -eq 3 -and $refusal -eq 'probe_env_missing') { 'env' } elseif ($exitCode -eq 3 -and $refusal) { 'gate' } elseif ($newOut.Count -gt 0) { 'past_key_lookup' } else { 'UNEXPECTED' }
$keyLookupPassed = (@('env', 'gate', 'key_lookup') -notcontains $stage)   # UNEXPECTED counts as passed: it cannot be shown the key file was not opened
$keyRead = $keyLookupPassed -or ($newOut.Count -gt 0) -or ($keyDirAfter.Count -gt 0)
$networkReached = ($exitCode -ne 3) -or ($newOut.Count -gt 0) -or $keyLookupPassed
$verdict = if ($stage -eq 'key_lookup' -and -not $networkReached -and -not $keyRead) { 'DRY RUN PASS' } else { 'DRY RUN FAIL' }
$clHead = (Invoke-G @('-C', $cloneFull, 'rev-parse', 'HEAD'))[0].Trim()
$summary = [ordered]@{
  mode = 'NO_KEY_DRY_RUN'; verdict = $verdict; stage = $stage; probe_exit_code = $exitCode; refusal_reason = $refusal; probe_output = [string[]]@($out | ForEach-Object { Redact $_ })
  network_step_reached = $networkReached; key_lookup_passed = $keyLookupPassed; key_read = $keyRead; key_dir_entries_after = [string[]]$keyDirAfter; probe_output_dirs_created = [string[]]$newOut
  doc_commit = $DocCommit; doc_blob = $blobId; doc_sha256 = $DocSha256; script_sha256_bom = $scriptHash
  clone_dir = $cloneFull; clone_reused_via_sentinel = $reused; clone_head = $clHead; pinned_commit = $PinCommit; git_source = $git
  git_terminal_prompt = $env:GIT_TERMINAL_PROMPT; gcm_interactive = $env:GCM_INTERACTIVE
  runner_ps = $PSVersionTable.PSVersion.ToString(); probe_ps = $psExe; evidence_dir = $evDir
  captured_pt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'); captured_utc = (Get-Date).ToUniversalTime().ToString('o')
}
$sumPath = Join-Path $evDir 'dryrun_summary.json'
$summary | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $sumPath
Write-Host ''; Write-Host ('probe exit code : ' + $exitCode); Write-Host ('refusal reason  : ' + $refusal); Write-Host ('stage           : ' + $stage); Write-Host ('key_read        : ' + $keyRead)
Write-Host ('evidence dir    : ' + $evDir); Write-Host ('summary.json    : ' + $sumPath); Get-Content -LiteralPath $sumPath | Write-Host
Write-Host ''; Write-Host $verdict
if ($verdict -eq 'DRY RUN PASS') { exit 0 } else { exit 1 }
