#!/usr/bin/env bash
# Builds and runs the companion KAT with g++ and clang++, optimized and under ASan/UBSan. Box only; no Unreal.
set -euo pipefail
cd "$(dirname "$0")/../../.."  # repo root (this script lives in wonderland/Tools/companion/)
D=wonderland/Source/Wonderland
SRC=(wonderland/Tools/j1_companion_kat.cpp "$D/WonderlandCompanionLogic.cpp" "$D/WonderlandJuliusMissionProgress.cpp" "$D/WonderlandJuliusMissionLogic.cpp")
FLAGS=(-std=c++17 -Wall -Wextra -Werror -pedantic -Wshadow -I "$D")
SAN=(-O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer)
OUT=${OUT_DIR:-/tmp/companion-kat}
mkdir -p "$OUT"
for CXX in g++ clang++; do
	"$CXX" --version | head -n1
	"$CXX" "${FLAGS[@]}" -O2 "${SRC[@]}" -o "$OUT/kat-$CXX-O2"
	echo "[$CXX -O2]"; "$OUT/kat-$CXX-O2"
	"$CXX" "${FLAGS[@]}" "${SAN[@]}" "${SRC[@]}" -o "$OUT/kat-$CXX-asan"
	echo "[$CXX ASan+UBSan]"; ASAN_OPTIONS=detect_leaks=1 UBSAN_OPTIONS=print_stacktrace=1 "$OUT/kat-$CXX-asan"
done
echo "ALL BUILDS PASS"
