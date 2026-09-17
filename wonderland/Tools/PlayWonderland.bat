@echo off
REM Open Wonderland the way the world lane's sessions open it.
REM
REM WHY THIS EXISTS. Opening the .uproject by hand gives an editor with no scripted channel, and it holds
REM UnrealEditor-Wonderland.dll -- so the next C++ fix cannot be linked and the build fails (2026-09-17, editor 88).
REM An editor started here loads the same world AND listens on the channel, so a session can take captures, apply a
REM layer or close it for a rebuild without anyone having to hunt for the window.
REM
REM It does not build. If a fix was just merged, let the session build first.

setlocal
set UE=C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe
set PROJECT=C:\dev\iwonder\wonderland-task3\wonderland\Wonderland.uproject
set MAP=/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2
set CHANNEL=C:\Users\Kaisi\.claude\jobs\ec4f540e\tmp\channel
set CHANNEL_PY=C:\dev\iwonder\wonderland-task3\wonderland\Tools\editor_channel.py
set LOG=C:\dev\iwonder\recovery\_manifests\wl-live-editor-founder.log

if not exist "%UE%" (echo Unreal 5.8 not found at "%UE%" & exit /b 1)
if not exist "%PROJECT%" (echo Wonderland.uproject not found at "%PROJECT%" & exit /b 1)

echo Opening Wonderland (Golden Arrival)...
start "" "%UE%" "%PROJECT%" "%MAP%" -ForceEnablePython ^
  "-ExecCmds=r.Streaming.PoolSize 400, py %CHANNEL_PY% %CHANNEL%" ^
  -nosplash -NoLiveCoding "-ABSLOG=%LOG%"
endlocal
