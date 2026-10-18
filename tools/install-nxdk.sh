#!/bin/sh
# Clones nxdk (the open-source original Xbox SDK) at a pinned commit into
# .tools/nxdk and builds its libraries once. Needs git, make, clang, lld,
# llvm (llvm-lib), cmake, flex and bison. No Microsoft code is involved.
set -eu
COMMIT="${NXDK_COMMIT:-14d5ee97e73347c973f1f57b68b79ec08c9e77f2}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/.tools/nxdk"
if [ ! -d "$DIR/.git" ]; then
  git clone https://github.com/XboxDev/nxdk.git "$DIR"
fi
cd "$DIR"
if [ "$(git rev-parse HEAD)" != "$COMMIT" ]; then
  git fetch origin "$COMMIT"
  git checkout -q "$COMMIT"
fi
git submodule update --init --recursive
# building a sample builds the libraries and tools (cxbe, extract-xiso) once
export NXDK_DIR="$DIR" PATH="$DIR/bin:$PATH"
make -C samples/hello -j"$(nproc 2>/dev/null || echo 2)"
echo "nxdk $(git rev-parse --short HEAD) ready in $DIR"
