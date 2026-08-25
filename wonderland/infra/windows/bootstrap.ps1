<powershell>
# Wonderland Windows GPU workstation -- unattended first-boot bootstrap.
#
# Runs as SYSTEM via EC2 user data on a Windows Server 2022 "Full" AMI.
# Everything here is UNATTENDED. The interactive steps it deliberately does
# NOT attempt are, in order: Epic Games Launcher sign-in + UE 5.8 install,
# and the Aura account sign-in. Both are noted at the end of the log.
#
# Windows Server AMIs do not ship winget, and user data runs before any user
# profile exists, so every install below is a direct-download silent installer.
$ErrorActionPreference = 'Continue'
$log = 'C:\wonderland-bootstrap.log'
function Say($m) { $t = Get-Date -Format 'HH:mm:ss'; "$t  $m" | Tee-Object -FilePath $log -Append }
New-Item -ItemType Directory -Force -Path C:\dl, C:\wonderland | Out-Null
Say 'BOOTSTRAP START'

# ---- 1. NVIDIA GRID / RTX vWS driver -----------------------------------------
# Free on EC2 under the NVIDIA GRID Cloud EULA for L4/L40S/A10G/T4. GRID (not
# the gaming driver) because it enables Quadro Virtual Workstation mode and up
# to 4 displays in DCV. G6/L4 needs GRID >= 17.1, G6e/L40S >= 17.4.
Say 'NVIDIA driver: fetching newest from s3://ec2-windows-nvidia-drivers/latest'
try {
  $obj = (Get-S3Object -BucketName ec2-windows-nvidia-drivers -KeyPrefix latest |
          Where-Object { $_.Key -like '*server2022*' -or $_.Key -like '*.exe' } |
          Sort-Object LastModified -Descending | Select-Object -First 1)
  if ($obj) {
    Copy-S3Object -BucketName ec2-windows-nvidia-drivers -Key $obj.Key -LocalFile C:\dl\nvidia.exe
    Start-Process C:\dl\nvidia.exe -ArgumentList '-s','-noreboot' -Wait
    Say "NVIDIA driver installed from $($obj.Key)"
  } else { Say 'NVIDIA driver: NO OBJECT MATCHED -- install manually' }
} catch { Say "NVIDIA driver FAILED: $_" }

# ---- 2. Amazon DCV server (the ChromeOS browser desktop) ---------------------
# Free on EC2 -- no license server; the instance self-licenses from
# s3://dcv-license.<region> via its instance role. Web client needs no install
# on the Chromebook.
Say 'Amazon DCV: downloading server'
try {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://d1uj6qtbmh3dt5.cloudfront.net/nice-dcv-server-x64-Release.msi' -OutFile C:\dl\dcv.msi
  Start-Process msiexec.exe -ArgumentList '/i','C:\dl\dcv.msi','/quiet','/norestart','ADDLOCAL=ALL' -Wait
  # console session, TCP+UDP 8443, owner = Administrator
  New-Item -Path 'HKLM:\SOFTWARE\GSettings\com\nicesoftware\dcv\session-management\automatic-console-session' -Force | Out-Null
  New-ItemProperty -Path 'HKLM:\SOFTWARE\GSettings\com\nicesoftware\dcv\session-management\automatic-console-session' -Name owner -Value 'Administrator' -PropertyType String -Force | Out-Null
  Restart-Service dcvserver -ErrorAction SilentlyContinue
  Say 'Amazon DCV installed; browser desktop on https://<public-ip>:8443'
} catch { Say "DCV FAILED: $_" }

# ---- 3. Media Foundation ------------------------------------------------------
# Windows Server does not ship it and the Unreal editor needs it.
Say 'Media Foundation feature'
try { Install-WindowsFeature Server-Media-Foundation -ErrorAction Stop | Out-Null; Say 'Media Foundation installed' }
catch { Say "Media Foundation: $_" }

# ---- 4. Git + Git LFS ---------------------------------------------------------
Say 'Git for Windows + Git LFS'
try {
  $gitUrl = (Invoke-RestMethod https://api.github.com/repos/git-for-windows/git/releases/latest).assets |
            Where-Object { $_.name -like '*64-bit.exe' } | Select-Object -First 1 -ExpandProperty browser_download_url
  Invoke-WebRequest -UseBasicParsing -Uri $gitUrl -OutFile C:\dl\git.exe
  Start-Process C:\dl\git.exe -ArgumentList '/VERYSILENT','/NORESTART','/NOCANCEL','/SP-','/SUPPRESSMSGBOXES' -Wait
  $lfsUrl = (Invoke-RestMethod https://api.github.com/repos/git-lfs/git-lfs/releases/latest).assets |
            Where-Object { $_.name -like 'git-lfs-windows-v*.exe' } | Select-Object -First 1 -ExpandProperty browser_download_url
  Invoke-WebRequest -UseBasicParsing -Uri $lfsUrl -OutFile C:\dl\gitlfs.exe
  Start-Process C:\dl\gitlfs.exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait
  $env:PATH += ';C:\Program Files\Git\cmd'
  & 'C:\Program Files\Git\cmd\git.exe' lfs install --system
  Say 'Git + Git LFS installed'
} catch { Say "Git FAILED: $_" }

# ---- 5. Visual Studio 2022 Build Tools ---------------------------------------
# Build Tools SUFFICE for Wonderland's single Runtime C++ module against a
# launcher BINARY engine: the launcher ships a precompiled UnrealBuildTool and
# UBT finds the toolchain through vswhere. The full IDE is only needed for the
# Visual Studio Tools for Unreal experience.
Say 'VS 2022 Build Tools (VCTools + Windows 11 SDK + .NET)'
try {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile C:\dl\vs_BuildTools.exe
  Start-Process C:\dl\vs_BuildTools.exe -ArgumentList `
    '--quiet','--wait','--norestart','--nocache',
    '--add','Microsoft.VisualStudio.Workload.VCTools',
    '--add','Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '--add','Microsoft.VisualStudio.Component.Windows11SDK.26100',
    '--add','Microsoft.Net.Component.4.8.SDK',
    '--add','Microsoft.NetCore.Component.SDK' -Wait
  Say 'VS Build Tools installed'
} catch { Say "VS Build Tools FAILED: $_" }

# ---- 6. Epic Games Launcher (installer only; engine install is interactive) ---
Say 'Epic Games Launcher (silent MSI)'
try {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi' -OutFile C:\dl\epic.msi
  Start-Process msiexec.exe -ArgumentList '/i','C:\dl\epic.msi','/qn','/norestart' -Wait
  Say 'Epic Games Launcher installed (NOT signed in, NO engine yet)'
} catch { Say "Epic Launcher FAILED: $_" }

# ---- 7. The repository --------------------------------------------------------
# Cloned with a DEPLOY KEY placed by the launcher script, so no browser login
# and no account-wide token on the box. Read/write, single repo, revocable.
Say 'Cloning sunday-relay @ relay/wonderland-hd-rebuild'
try {
  $ssh = 'C:\Users\Administrator\.ssh'
  New-Item -ItemType Directory -Force -Path $ssh | Out-Null
  if (Test-Path C:\dl\deploy_key) {
    Move-Item C:\dl\deploy_key "$ssh\id_ed25519" -Force
    icacls "$ssh\id_ed25519" /inheritance:r /grant:r "Administrator:(R)" | Out-Null
    'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' | Out-File -Encoding ascii "$ssh\known_hosts"
    & 'C:\Program Files\Git\cmd\git.exe' clone --branch relay/wonderland-hd-rebuild git@github.com:ohdieyuh-glitch/sunday-relay.git C:\wonderland\sunday-relay
    Say 'Repository cloned'
  } else { Say 'NO DEPLOY KEY at C:\dl\deploy_key -- clone skipped' }
} catch { Say "Clone FAILED: $_" }

Say 'BOOTSTRAP COMPLETE.'
Say 'REMAINING INTERACTIVE STEPS (in the DCV browser desktop):'
Say '  1. Epic Games Launcher -> sign in -> Unreal Engine 5.8 -> Install (no CLI exists for this)'
Say '  2. Aura installer from tryaura.dev -> pick UE 5.8 -> sign in'
</powershell>
<persist>true</persist>
