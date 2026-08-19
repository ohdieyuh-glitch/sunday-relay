#!/bin/bash
# RESUME CALIFORNIA — everything needed after the instance is started again.
#
# The instance stops at its scheduled end_date, so its disk survives: UE, the
# packaged build, the generated textures and audio, and every script under
# /opt/wonderland. What a restart does NOT bring back is the running processes
# (TURN, signalling, the streamer, the tunnel), and the Cloudflare quick-tunnel
# URL is regenerated, so the founder-facing link changes every single time.
#
#   ./resume-california.sh            restart the stack, rebuild, capture
#   ./resume-california.sh nobuild    restart the stack only
#
# Override any of these if the instance moved:
#   CA_HOST=ssh8.vast.ai CA_PORT=38960 CA_USER=root CA_KEY=~/.ssh/id_ed25519
#   OUT_DIR=./wonderland-capture
#
# NOTE: this needs an SSH route to the box. Vast's proxy port and the direct
# port are both high ports, so a network that only permits 80/443 cannot run
# this at all — check with `ssh -p 22 git@github.com` before blaming the host.
set -u

CA_HOST="${CA_HOST:-ssh8.vast.ai}"
CA_PORT="${CA_PORT:-38960}"
CA_USER="${CA_USER:-root}"
CA_KEY="${CA_KEY:-$HOME/.ssh/id_ed25519}"
OUT_DIR="${OUT_DIR:-./wonderland-capture}"
MODE="${1:-build}"

# repo root, derived — the previous version of this file hard-coded an
# author's scratchpad directory and could not have run anywhere else
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT_DIR"

ca() { ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=30 \
           -i "$CA_KEY" -p "$CA_PORT" "$CA_USER@$CA_HOST" "$@"; }

say() { printf '\n=== %s\n' "$*"; }

say "waiting for ssh (this laptop also has to stop blocking outbound 22)"
ok=0
for i in $(seq 1 60); do
  if ca 'echo up' 2>/dev/null | grep -q up; then ok=1; break; fi
  sleep 20
done
[ "$ok" = 1 ] || { echo "ssh still unreachable; check 'ssh -p 22 git@github.com' for the local port block"; exit 1; }

say "restarting the streaming stack"
ca 'set -u
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
  [ -f "$HERE/$f" ] || continue
  for t in 1 2 3; do
    ca "cat > /home/ue4/wonderland-src/infra/build/$f" < "$HERE/$f" 2>/dev/null && break
    sleep 5
  done
  L=$(md5sum "$HERE/$f" | cut -d' ' -f1)
  R=$(ca "md5sum /home/ue4/wonderland-src/infra/build/$f" 2>/dev/null | tail -1 | cut -d' ' -f1)
  [ "$L" = "$R" ] && echo "  synced $f" || { echo "  SYNC MISMATCH $f"; exit 2; }
done
ca 'chown ue4:ue4 /home/ue4/wonderland-src/infra/build/*.py
# gen-textures.py changed this session, so the cached PNGs and their imported
# uassets both have to go or the old maps are silently reused
rm -rf /opt/wonderland/textures /home/ue4/wonderland-src/Content/Wonderland/Textures'

say "rebuilding (FORCE_REBUILD; the input hash does not cover infra/build)"
ca '/root/run-build3.sh'
ca 'for i in $(seq 1 120); do grep -qa "packaged Wonderland\|BUILD FAILED\|ERROR: " /opt/wonderland/build.log && break; sleep 10; done
grep -a "packaged Wonderland\|BUILD FAILED\|ERROR: " /opt/wonderland/build.log | tail -2
echo "--- generator warnings ---"
grep -a "LogPython: Warning" /opt/wonderland/build.log | sed "s/^.*LogPython: //" | cut -c1-120 | sort -u | head -12'

say "capturing the hero frame"
ca 'test -x /opt/wonderland/ca/cycle.sh || cat > /opt/wonderland/ca/cycle.sh <<"EOS"
#!/bin/bash
set -u
OUT="${1:-/opt/wonderland/proof/shot.png}"
pkill -f "[a]pp-run.sh" >/dev/null 2>&1
pgrep -x Wonderland | while read -r p; do kill -9 "$p" 2>/dev/null; done
sleep 4
: > /opt/wonderland/ca/app.log
setsid nohup /opt/wonderland/ca/app-run.sh >/dev/null 2>&1 < /dev/null &
for i in $(seq 1 60); do
  grep -qa "Local participant joined the room" /opt/wonderland/ca/app.log 2>/dev/null && break
  sleep 3
done
sleep 8
NODE=$(find /opt/ue-root -path "*platform_scripts/bash/node/bin/node" 2>/dev/null | head -1)
cd /opt/wonderland/proof && "$NODE" shot.cjs "http://127.0.0.1:8080/" 2>&1 | tail -6
cp /opt/wonderland/proof/wonderland.png "$OUT"
nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader
EOS
chmod +x /opt/wonderland/ca/cycle.sh' 
ca '/opt/wonderland/ca/cycle.sh /opt/wonderland/proof/resume.png' | tail -4
ca 'base64 -w0 /opt/wonderland/proof/resume.png' 2>/dev/null | tail -1 | base64 -d > "$OUT_DIR/resume.png"
file "$OUT_DIR/resume.png"

say "founder URL"
ca 'cat /opt/wonderland/player-url.txt'
