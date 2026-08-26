#!/usr/bin/env bash
# Install the V1 write-guard as a git pre-commit hook. Hooks are not versioned,
# so run this once per clone/worktree:  bash wonderland/tools/install-hooks.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS"
cat > "$HOOKS/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# Wonderland V1 write-guard (see wonderland/V1-LEGACY-MANIFEST.md)
ROOT="$(git rev-parse --show-toplevel)"
if [ -f "$ROOT/wonderland/tools/v1_guard.py" ]; then
  python3 "$ROOT/wonderland/tools/v1_guard.py" || exit 1
fi
HOOK
chmod +x "$HOOKS/pre-commit"
echo "installed $HOOKS/pre-commit"
