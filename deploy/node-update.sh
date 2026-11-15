#!/usr/bin/env bash
# Keeps Node.js 24 on its newest release. Node comes from nodejs.org, not Ubuntu, so Ubuntu's automatic security
# updates never touch it: this does, weekly (and setup-server.sh runs it). The download's checksum is checked
# before anything is installed; the site restarts on the new version and, if it doesn't come back healthy, the
# previous Node goes back in. setup-server.sh installs this as /usr/local/sbin/shadowcrypts-node-update.
set -euo pipefail

LINE=latest-v24.x
installed="$(node --version 2>/dev/null || echo none)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL --max-time 60 -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$LINE/SHASUMS256.txt"
file="$(grep -oE 'node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' "$tmp/SHASUMS256.txt" | head -1)"
latest="$(echo "$file" | grep -oE 'v24\.[0-9]+\.[0-9]+')"
if [ -z "$latest" ]; then echo "Couldn't read the latest Node 24 release: nothing changed."; exit 0; fi
if [ "$installed" = "$latest" ]; then echo "Node $installed is the newest 24 release."; exit 0; fi

echo "Node $installed -> $latest"
curl -fsSL --max-time 300 -o "$tmp/$file" "https://nodejs.org/dist/$LINE/$file"
(cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c - >/dev/null)
[ -x /usr/local/bin/node ] && cp -p /usr/local/bin/node "$tmp/node.previous"
tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --no-same-owner --exclude='CHANGELOG.md' --exclude='LICENSE' --exclude='README.md'
echo "Installed node $(node --version), npm $(npm --version)"

# The running site picks up the new Node on a restart; if it isn't healthy within two minutes, roll back.
if systemctl is-active --quiet shadowcrypts 2>/dev/null; then
  systemctl restart shadowcrypts
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null --max-time 3 http://127.0.0.1:3000/api/health; then echo "The site is up on Node $latest."; exit 0; fi
    sleep 2
  done
  if [ -f "$tmp/node.previous" ]; then
    echo "The site didn't come back on Node $latest: putting $installed back."
    install -m 755 "$tmp/node.previous" /usr/local/bin/node
    systemctl restart shadowcrypts
  fi
  exit 1
fi
