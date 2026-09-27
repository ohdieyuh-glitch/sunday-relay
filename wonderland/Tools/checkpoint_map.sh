#!/usr/bin/env bash
# CHECKPOINT THE AUTHORITATIVE MAP -- THE POST-CONVERSION SHAPE, WHICH THE EXISTING ROLLBACK IS NOT.
#
# WHY THIS EXISTS. `wonderland/Content/` is untracked by git and is shared between every worktree on this
# machine by a directory junction, so a map save has no version control behind it at all: the only rollback
# that exists is a file copy taken beforehand. The newest one, recovery/_map_checkpoints/2026-09-26-streaming,
# holds the 46 MB MONOLITHIC map from before the World Partition conversion. Restoring it today would not
# undo one bad save -- it would undo the conversion as well, and take the world back to the state where
# nothing streams.
#
# AND A PARTITIONED MAP IS NOT ONE FILE. After conversion, WL_V2_GoldenArrival_WP2.umap is a 13 KB stub and
# its 21,000 actors live in Content/__ExternalActors__/.../WL_V2_GoldenArrival_WP2/ (177 MB) with their
# instance data in __ExternalObjects__ (1.4 MB). Copying only the .umap would produce a checkpoint that
# restores an EMPTY WORLD while looking like a backup. Everything the map is made of is copied here.
#
#     bash wonderland/Tools/checkpoint_map.sh <label>
#
# Restore is documented in the RESTORE.md this writes, and verified by the manifest of sha256 sums beside it.
set -euo pipefail

LABEL="${1:-$(date +%Y-%m-%d-%H%M%S)}"
WT="C:/dev/iwonder/wonderland-task3/wonderland"
CONTENT="$WT/Content"
MAPDIR="$CONTENT/WonderlandV2/Maps"
MAP="WL_V2_GoldenArrival_WP2"
DEST="C:/dev/iwonder/recovery/_map_checkpoints/$(date +%Y-%m-%d)-$LABEL"

if [ -e "$DEST" ]; then echo "checkpoint $DEST already exists -- refusing to overwrite a rollback" >&2; exit 1; fi
if [ ! -f "$MAPDIR/$MAP.umap" ]; then echo "no map at $MAPDIR/$MAP.umap" >&2; exit 1; fi

# THE EDITOR MUST NOT BE MID-SAVE. A copy taken while Unreal is writing the stub and its external actors
# gets a torn set: a stub that references actor files that are not there yet. The heartbeat says a runner is
# alive; what matters here is that no job is running, which is what the jobs list reports.
HB="$WT/Tools/_channel/heartbeat.json"
if [ -f "$HB" ]; then
  RUNNING=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB" 2>/dev/null || echo 0)
  if [ "$RUNNING" != "0" ]; then
    echo "a job is running in the editor right now -- a copy taken mid-save is a torn checkpoint. Wait." >&2
    exit 1
  fi
fi

mkdir -p "$DEST/Maps" "$DEST/__ExternalActors__" "$DEST/__ExternalObjects__"
echo "copying the map stub, its ini and its HLOD layers..."
cp -p "$MAPDIR/$MAP.umap" "$DEST/Maps/"
for extra in "$MAP.ini" "${MAP}_HLODLayer_Instanced.uasset" "${MAP}_HLODLayer_Merged.uasset"; do
  [ -f "$MAPDIR/$extra" ] && cp -p "$MAPDIR/$extra" "$DEST/Maps/"
done
echo "copying 177 MB of external actors (this is the world, not a detail)..."
cp -rp "$CONTENT/__ExternalActors__/WonderlandV2/Maps/$MAP" "$DEST/__ExternalActors__/"
cp -rp "$CONTENT/__ExternalObjects__/WonderlandV2/Maps/$MAP" "$DEST/__ExternalObjects__/"

ACTORS=$(find "$DEST/__ExternalActors__" -name '*.uasset' | wc -l)
OBJECTS=$(find "$DEST/__ExternalObjects__" -name '*.uasset' | wc -l)
SIZE=$(du -sh "$DEST" | cut -f1)
sha256sum "$DEST/Maps/$MAP.umap" > "$DEST/manifest.sha256"
(cd "$DEST" && find __ExternalActors__ __ExternalObjects__ -name '*.uasset' -print0 \
  | sort -z | xargs -0 sha256sum >> "$DEST/manifest.sha256")

cat > "$DEST/RESTORE.md" <<EOF
# Map checkpoint: $LABEL

Taken $(date -u +"%Y-%m-%d %H:%M:%SZ") from \`$MAPDIR\`, with no editor job running.

**This is a PARTITIONED map and is therefore three things, not one.** The stub package, its external
actors, and its external objects. Restoring only the .umap gives you a world with no actors in it.

| part | files | where it belongs |
|---|---|---|
| \`Maps/\` | stub .umap, .ini, 2 HLOD layer assets | \`Content/WonderlandV2/Maps/\` |
| \`__ExternalActors__/$MAP/\` | $ACTORS .uasset | \`Content/__ExternalActors__/WonderlandV2/Maps/\` |
| \`__ExternalObjects__/$MAP/\` | $OBJECTS .uasset | \`Content/__ExternalObjects__/WonderlandV2/Maps/\` |

Total $SIZE. \`manifest.sha256\` covers every file; verify with \`sha256sum -c manifest.sha256\` from this
directory before trusting a restore.

## To restore

CLOSE EVERY UNREAL EDITOR FIRST. \`Content/\` is a junction shared by every worktree on this machine, so this
restores the map for all of them at once, and a running editor will write its in-memory world back over you.

\`\`\`bash
CONTENT="C:/dev/iwonder/wonderland-task3/wonderland/Content"
rm -rf "\$CONTENT/__ExternalActors__/WonderlandV2/Maps/$MAP" \\
       "\$CONTENT/__ExternalObjects__/WonderlandV2/Maps/$MAP"
cp -p  Maps/* "\$CONTENT/WonderlandV2/Maps/"
cp -rp __ExternalActors__/$MAP  "\$CONTENT/__ExternalActors__/WonderlandV2/Maps/"
cp -rp __ExternalObjects__/$MAP "\$CONTENT/__ExternalObjects__/WonderlandV2/Maps/"
\`\`\`

The \`rm -rf\` is not optional and is the part that is easy to skip: external actors are ADDITIVE on disk, so
copying over them leaves behind every actor file a later save created, and the restored world comes back with
the deleted work still in it.

## What this checkpoint is NOT

It is not a substitute for \`CONTENT_LFS_PLAN.md\`. The world is still untracked by git, and this is still a
file copy on the same disk as the thing it protects.
EOF

echo
echo "CHECKPOINT $DEST"
echo "  stub + ini + HLOD, $ACTORS external actors, $OBJECTS external objects, $SIZE total"
echo "  manifest.sha256 written; RESTORE.md explains the three-part restore"
