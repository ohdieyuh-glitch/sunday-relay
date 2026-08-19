#!/bin/bash
# (repo copy of the session scratchpad script, kept so the resume path is not
#  itself something that only exists on one laptop)
# RESUME CALIFORNIA — everything needed after the instance is started again.
#
# The instance stopped at its scheduled end_date, so its 350 GB disk is intact:
# UE 5.8.1, the packaged build, the generated textures and audio, and every
# script under /opt/wonderland. What a restart does NOT bring back is the
# running processes (signalling, TURN, the streamer, the tunnel), and the
# Cloudflare quick-tunnel URL is regenerated, so the founder-facing link changes.
#
# Usage:  resume-ca.sh            wait for ssh, restart the stack, rebuild, capture
#         resume-ca.sh nobuild    restart the stack only
set -u
SP=/tmp/claude-1000/-home-kaisinrogodfree5/16952c76-a107-45e8-8f0a-73d9991ab0eb/scratchpad
CA="$SP/ca"
REPO=/home/kaisinrogodfree5/wonderland-ca-fixes/wonderland/infra/build
MODE="${1:-build}"

say() { printf '\n=== %s\n' "$*"; }

say "waiting for ssh (this laptop also has to stop blocking outbound 22)"
ok=0
for i in $(seq 1 60); do
  if $CA 'echo up' 2>/dev/null | grep -q up; then ok=1; break; fi
  sleep 20
done
[ "$ok" = 1 ] || { echo "ssh still unreachable; check 'ssh -p 22 git@github.com' for the local port block"; exit 1; }

say "restarting the streaming stack"
$CA 'set -u
for s in sig tunnel app-run; do pkill -f "[/]opt/wonderland/ca/$s.sh" >/dev/null 2>&1; done
pgrep -x Wonderland | while read -r p; do kill -9 "$p" 2>/dev/null; done
pkill -f "[c]loudflared" >/dev/null 2>&1
sleep 2
# TURN first: the media path needs it advertised in the signalling peer options
pgrep -x turnserver >/dev/null || (setsid nohup turnserver -c /etc/turnserver.conf >/var/log/turn.log 2>&1 < /dev/null &)
: > /opt/wonderland/ca/sig.log
setsid nohup /opt/wonderland/ca/sig.sh    >/dev/null 2>&1 < /dev/null &
sleep 6
: > /opt/wonderland/ca/tunnel.log
setsid nohup /opt/wonderland/ca/tunnel.sh >/dev/null 2>&1 < /dev/null &
: > /opt/wonderland/ca/app.log
setsid nohup /opt/wonderland/ca/app-run.sh >/dev/null 2>&1 < /dev/null &
for i in $(seq 1 40); do
  grep -qa "Local participant joined the room" /opt/wonderland/ca/app.log 2>/dev/null && break
  sleep 3
done
echo "--- listening ---"
for p in 8080 8888 3478; do h=$(printf "%04X" $p); grep -q ":$h " /proc/net/tcp && echo "tcp $p LISTEN"; done
echo "--- tunnel url ---"
grep -aoE "https://[a-z0-9-]+\.trycloudflare\.com" /opt/wonderland/ca/tunnel.log | tail -1 | tee /opt/wonderland/player-url.txt
nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader'

if [ "$MODE" = "nobuild" ]; then
  say "stack restarted; skipping the rebuild as asked"
  exit 0
fi

say "syncing the art pipeline (generator + textures + audio)"
for f in generate-hub-level.py gen-textures.py gen-audio.py; do
  [ -f "$REPO/$f" ] || continue
  for t in 1 2 3; do
    $CA "cat > /home/ue4/wonderland-src/infra/build/$f" < "$REPO/$f" 2>/dev/null && break
    sleep 5
  done
  L=$(md5sum "$REPO/$f" | cut -d' ' -f1)
  R=$($CA "md5sum /home/ue4/wonderland-src/infra/build/$f" 2>/dev/null | tail -1 | cut -d' ' -f1)
  [ "$L" = "$R" ] && echo "  synced $f" || { echo "  SYNC MISMATCH $f"; exit 2; }
done
$CA 'chown ue4:ue4 /home/ue4/wonderland-src/infra/build/*.py
# gen-textures.py changed this session, so the cached PNGs and their imported
# uassets both have to go or the old maps are silently reused
rm -rf /opt/wonderland/textures /home/ue4/wonderland-src/Content/Wonderland/Textures'

say "rebuilding (FORCE_REBUILD; the input hash does not cover infra/build)"
$CA '/root/run-build3.sh'
$CA 'for i in $(seq 1 120); do grep -qa "packaged Wonderland\|BUILD FAILED\|ERROR: " /opt/wonderland/build.log && break; sleep 10; done
grep -a "packaged Wonderland\|BUILD FAILED\|ERROR: " /opt/wonderland/build.log | tail -2
echo "--- generator warnings ---"
grep -a "LogPython: Warning" /opt/wonderland/build.log | sed "s/^.*LogPython: //" | cut -c1-120 | sort -u | head -12'

say "capturing the hero frame"
$CA '/opt/wonderland/ca/cycle.sh /opt/wonderland/proof/resume.png' | tail -4
$CA 'base64 -w0 /opt/wonderland/proof/resume.png' 2>/dev/null | tail -1 | base64 -d > "$SP/resume.png"
file "$SP/resume.png"

say "founder URL"
$CA 'cat /opt/wonderland/player-url.txt'
