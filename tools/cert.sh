#!/bin/sh
# Self-signed ECDSA P-256 certificate for WebTransport hash pinning. Chrome only
# accepts pinned certificates valid for at most 14 days, so this one gets 13 and
# is regenerated when it is more than 12 days old.
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$DIR"
if [ -f "$DIR/cert.pem" ] && [ -z "$(find "$DIR/cert.pem" -mtime +12)" ]; then
  exit 0
fi
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 13 \
  -subj /CN=localhost -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" 2>/dev/null
openssl x509 -in "$DIR/cert.pem" -outform der | openssl dgst -sha256 -binary | base64 > "$DIR/hash.txt"
echo "certs/cert.pem, sha-256 $(cat "$DIR/hash.txt")"
