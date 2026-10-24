#!/usr/bin/env bash
# Lints the core for provider literals, then builds and runs the companion KAT with g++ and clang++, optimized and under ASan/UBSan. Box only; no Unreal.
set -euo pipefail
cd "$(dirname "$0")/../../.."  # repo root (this script lives in wonderland/Tools/companion/)
D=wonderland/Source/Wonderland
SRC=(wonderland/Tools/j1_companion_kat.cpp "$D/WonderlandCompanionLogic.cpp" "$D/WonderlandJuliusMissionProgress.cpp" "$D/WonderlandJuliusMissionLogic.cpp")
FLAGS=(-std=c++17 -Wall -Wextra -Werror -pedantic -Wshadow -I "$D")
SAN=(-O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer)
OUT=${OUT_DIR:-/tmp/companion-kat}
mkdir -p "$OUT"

# Provider-literal lint: the core never names a provider. Literals are allowed only inside
#   // BEGIN PROVIDER-ADAPTER  ...  // END PROVIDER-ADAPTER
# blocks (none exist today). An unterminated or nested block fails too. Test data lives in Tools/, which is not linted.
CORE=("$D/WonderlandCompanionLogic.h" "$D/WonderlandCompanionLogic.cpp" "$D/WonderlandCompanionClient.h" "$D/WonderlandCompanionClient.cpp")
lint_provider_literals() {
	awk '
		BEGIN { bad = 0; hits = 0 }
		FNR == 1 { if (inblock) { printf "%s: unterminated PROVIDER-ADAPTER block\n", prev; bad = 1 } inblock = 0; prev = FILENAME }
		/\/\/ BEGIN PROVIDER-ADAPTER/ { if (inblock) { printf "%s:%d: nested PROVIDER-ADAPTER block\n", FILENAME, FNR; bad = 1 } inblock = 1; next }
		/\/\/ END PROVIDER-ADAPTER/ { if (!inblock) { printf "%s:%d: END without BEGIN\n", FILENAME, FNR; bad = 1 } inblock = 0; next }
		!inblock && tolower($0) ~ /grok|chatgpt|openai|claude|anthropic|gemini|xai/ { printf "%s:%d: provider literal: %s\n", FILENAME, FNR, $0; hits++ }
		END { if (inblock) { printf "%s: unterminated PROVIDER-ADAPTER block\n", prev; bad = 1 } printf "hits=%d\n", hits; exit (bad || hits) ? 1 : 0 }
	' "$@"
}
# Self-test: the lint must catch a literal, honour a block, and refuse an open block.
LT="$OUT/lint-selftest"; mkdir -p "$LT"
printf 'int a; // talks to OpenAI\n' > "$LT/hit.h"
printf '// BEGIN PROVIDER-ADAPTER\nconst char* P = "gemini";\n// END PROVIDER-ADAPTER\nint b;\n' > "$LT/block.h"
printf '// BEGIN PROVIDER-ADAPTER\nconst char* P = "x";\n' > "$LT/open.h"
printf 'int c; // XAI\n' > "$LT/case.h"
if lint_provider_literals "$LT/hit.h" >/dev/null; then echo "LINT SELFTEST FAIL (literal missed)"; exit 1; fi
if ! lint_provider_literals "$LT/block.h" >/dev/null; then echo "LINT SELFTEST FAIL (block not honoured)"; exit 1; fi
if lint_provider_literals "$LT/open.h" >/dev/null; then echo "LINT SELFTEST FAIL (open block accepted)"; exit 1; fi
if lint_provider_literals "$LT/case.h" >/dev/null; then echo "LINT SELFTEST FAIL (case-insensitive miss)"; exit 1; fi
if ! LINT_OUT=$(lint_provider_literals "${CORE[@]}"); then echo "$LINT_OUT"; echo "LINT PROVIDER-LITERALS FAIL"; exit 1; fi
echo "LINT PROVIDER-LITERALS PASS files=${#CORE[@]} ${LINT_OUT##*$'\n'} (selftest 4/4)"
for CXX in g++ clang++; do
	"$CXX" --version | head -n1
	"$CXX" "${FLAGS[@]}" -O2 "${SRC[@]}" -o "$OUT/kat-$CXX-O2"
	echo "[$CXX -O2]"; "$OUT/kat-$CXX-O2"
	"$CXX" "${FLAGS[@]}" "${SAN[@]}" "${SRC[@]}" -o "$OUT/kat-$CXX-asan"
	echo "[$CXX ASan+UBSan]"; ASAN_OPTIONS=detect_leaks=1 UBSAN_OPTIONS=print_stacktrace=1 "$OUT/kat-$CXX-asan"
done
echo "ALL BUILDS PASS"
