#!/bin/sh
# Installs the pinned Deno into .tools/ (no global install).
set -eu
VERSION="${DENO_VERSION:-v2.9.7}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/.tools"
mkdir -p "$DIR"
if [ -x "$DIR/deno" ] && "$DIR/deno" --version | grep -q "deno ${VERSION#v}"; then
  exit 0
fi
TMP="$(mktemp -d)"
curl -fsSL "https://dl.deno.land/release/${VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o "$TMP/deno.zip"
python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP/deno.zip" "$DIR"
chmod +x "$DIR/deno"
rm -rf "$TMP"
"$DIR/deno" --version
