#!/usr/bin/env bash
# WONDERLAND -- WONDER WEB VM WINDOW LOOK: MUTATION CHECK FOR THE REMOVED PROVIDER-WORD FILTER.
#
# Team decision, 2026-10-23 (BRIDGE, FORGE, YUJI): any agentDisplayName is shown exactly as given ("Grok" is
# "Grok — Wonder Web VM 3"); only a missing/null name falls back to "Unnamed agent". This script proves the KAT guards
# that: it re-adds a provider-word filter to a scratch copy of WonderlandWonderWebWindowLook.cpp, one place at a time,
# and requires wonder_web_window_look_kat.cpp to FAIL against every mutant. The tracked source is never modified.
#
#   bash wonderland/Tools/wonder_web_window_look_mutants.sh      (from the repository root; needs perl and g++ or $CXX)
#   -> "MUTANT <id> killed" per mutant, then "WINDOW LOOK MUTANTS PASS killed=N of N", exit 0; any survivor exits 1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/wonderland/Source/Wonderland"
KAT="$ROOT/wonderland/Tools/wonder_web_window_look_kat.cpp"
CXX="${CXX:-g++}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The filter being re-added: the provider words the old list refused, compared ASCII case-insensitively.
cat > "$WORK/mutant_filter.h" <<'HDR'
#pragma once
#include <cctype>
#include <string>
inline bool WlMutantIsProviderWord(const std::string& Name)
{
	static const char* const Words[] = { "openai", "chatgpt", "claude", "claude-code", "grok", "gemini", "dev-companion" };
	std::string Lower = Name;
	for (char& Character : Lower) { Character = static_cast<char>(std::tolower(static_cast<unsigned char>(Character))); }
	for (const char* Word : Words) { if (Lower == Word) { return true; } }
	return false;
}
HDR

# id | perl substitution applied to the .cpp (each must match exactly once)
MUTANTS=(
	'M1-title|s/^(\t\t\t)Look\.Name = Name;$/$1Look.Name = WlMutantIsProviderWord(Name) ? std::string(UnnamedAgent) : Name;/m'
	'M2-observer-owner|s/^(\t\tLook\.OwnerName = SanitizeName\(View\.OwnerName\);)$/$1\n\t\tif (WlMutantIsProviderWord(Look.OwnerName)) { Look.OwnerName.clear(); }/m'
	'M3-parent-line|s/^(\t\t\t)Look\.Metadata = Parent;$/$1if (!WlMutantIsProviderWord(Parent)) { Look.Metadata = Parent; }/m'
)

Killed=0
Total=0
for Entry in "${MUTANTS[@]}"; do
	Id="${Entry%%|*}"
	Expr="${Entry#*|}"
	Total=$((Total + 1))
	Dir="$WORK/$Id"
	mkdir -p "$Dir"
	cp "$SRC/WonderlandWonderWebWindowLook.h" "$Dir/"
	perl -0pe "$Expr" "$SRC/WonderlandWonderWebWindowLook.cpp" > "$Dir/WonderlandWonderWebWindowLook.cpp"
	if cmp -s "$SRC/WonderlandWonderWebWindowLook.cpp" "$Dir/WonderlandWonderWebWindowLook.cpp"; then
		echo "MUTANT $Id NOT APPLIED (its anchor is gone; update this script)"
		exit 1
	fi
	if ! "$CXX" -std=c++17 -O1 -DWL_WINDOWLOOK_STANDALONE -include "$WORK/mutant_filter.h" -I "$Dir" \
		"$KAT" "$Dir/WonderlandWonderWebWindowLook.cpp" -o "$Dir/kat" 2> "$Dir/build.log"; then
		echo "MUTANT $Id DID NOT BUILD (not counted as killed)"
		cat "$Dir/build.log"
		exit 1
	fi
	if "$Dir/kat" > "$Dir/run.log" 2>&1; then
		echo "MUTANT $Id SURVIVED: the KAT passed with the provider filter re-added"
	else
		Killed=$((Killed + 1))
		echo "MUTANT $Id killed ($(grep -c '^FAIL ' "$Dir/run.log") failing checks)"
	fi
done

if [ "$Killed" -ne "$Total" ]; then
	echo "WINDOW LOOK MUTANTS FAIL killed=$Killed of $Total"
	exit 1
fi
echo "WINDOW LOOK MUTANTS PASS killed=$Killed of $Total"
