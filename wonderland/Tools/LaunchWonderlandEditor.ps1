# Launch the Wonderland editor WITH the scripted channel.
#
# WHY A SCRIPT AND NOT AN INLINE COMMAND. -ExecCmds carries a value containing both spaces and a comma
# ("r.Streaming.PoolSize 400, py <script> <channel>"). Passing that through PowerShell's -ArgumentList as an ARRAY
# splits it: the editor started, set no CVar and never ran the python, so it came up with no channel and nothing
# could be driven. Passing the whole argument list as ONE STRING preserves the quoting exactly the way
# Tools\PlayWonderland.bat does.
$ue = 'C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe'
$project = 'C:\dev\iwonder\wonderland-task3\wonderland\Wonderland.uproject'
$map = '/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2'
$channelPy = 'C:\dev\iwonder\wonderland-task3\wonderland\Tools\editor_channel.py'
$channel = 'C:\Users\Kaisi\.claude\jobs\ec4f540e\tmp\channel'
$log = 'C:\dev\iwonder\recovery\_manifests\wl-live-editor-103.log'

# QUARANTINE ANY AUTOSAVES BEFORE LAUNCHING. On 2026-09-22 the editor came up behind a modal "Restore
# Packages" dialog that looks exactly like a slow load -- responsive process, flat memory, the log frozen after
# the DDC line at frame 0 -- and ESC does not dismiss a Slate modal, so the only way out was to kill the editor
# and take 417 MB of autosaves out of the way. Autosave then wrote more, so the hazard returns on every launch.
# This MOVES them aside rather than deleting them: nothing potentially useful to a recovery is destroyed, and the
# folder can be put back by hand. Autosave itself stays on.
$autosaves = 'C:\dev\iwonder\wonderland-task3\wonderland\Saved\Autosaves'
$quarantine = 'C:\dev\iwonder\recovery\_autosave_quarantine'
if (Test-Path $autosaves) {
    $have = @(Get-ChildItem -Path $autosaves -Force -ErrorAction SilentlyContinue)
    if ($have.Count -gt 0) {
        if (-not (Test-Path $quarantine)) { New-Item -ItemType Directory -Force $quarantine | Out-Null }
        $dest = Join-Path $quarantine ('Autosaves-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -Path $autosaves -Destination $dest -Force
        Write-Output ("quarantined " + $have.Count + " autosave entries -> " + $dest)
    }
}

$argLine = '"{0}" "{1}" -ForceEnablePython "-ExecCmds=r.Streaming.PoolSize 400, py {2} {3}" -nosplash -NoLiveCoding "-ABSLOG={4}"' -f $project, $map, $channelPy, $channel, $log
Write-Output ("launching: " + $argLine)
Start-Process -FilePath $ue -ArgumentList $argLine
Start-Sleep -Seconds 15
Get-Process UnrealEditor -ErrorAction SilentlyContinue |
    Select-Object Id, @{n = 'GB'; e = { [math]::Round($_.WorkingSet64 / 1GB, 1) } } |
    Format-Table -AutoSize
