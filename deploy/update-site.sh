#!/usr/bin/env bash
# update-site: puts the latest version from GitHub on the website.
#
# It builds the new version next to the one that's running, so the site stays up meanwhile; switches over
# with a restart of a few seconds; checks the site answers; and goes back to the previous version on its
# own if the new one doesn't start. The last three versions are kept. Run it as root: update-site
set -euo pipefail

REPO="__REPO__"
APP=shadowcrypts
BASE=/srv/shadowcrypts
NEW="$BASE/releases/$(date +%Y%m%d-%H%M%S)"
LOG=/var/log/shadowcrypts-build.log

if [ "$(id -u)" -ne 0 ]; then echo "Run it as root: update-site" >&2; exit 1; fi
as_app() { runuser -u "$APP" -- "$@"; }
healthy() { curl -fs -o /dev/null --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null; }

echo "== Getting the latest version from GitHub"
as_app git clone --quiet --depth 1 "$REPO" "$NEW"
# The settings now (the build reads SITE_URL); the data folder only after building: the bundler follows
# paths into .cache and refuses a link that leads outside the project.
as_app ln -s "$BASE/shared/.env" "$NEW/.env"
echo "   $(as_app git -C "$NEW" log -1 --format='%h  %s  (%cr)')"

echo "== Installing what it needs (about a minute)"
cd "$NEW"
if ! as_app npm ci --no-audit --no-fund --loglevel=error > "$LOG" 2>&1; then
  echo "Installing failed, so the site wasn't touched. The end of the log:"; tail -20 "$LOG"; rm -rf "$NEW"; exit 1
fi

echo "== Building it (a few minutes)"
if ! as_app npm run build >> "$LOG" 2>&1; then
  echo "The build failed, so the site wasn't touched. The end of the log:"; tail -20 "$LOG"; rm -rf "$NEW"; exit 1
fi
as_app ln -s "$BASE/shared/.cache" "$NEW/.cache"

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
echo "== Switching the website over (a few seconds)"
ln -sfn "$NEW" "$BASE/current.next" && mv -Tf "$BASE/current.next" "$BASE/current"
systemctl restart shadowcrypts
for _ in $(seq 1 45); do healthy && break; sleep 2; done

if healthy; then
  # Keep the three newest versions.
  ls -1dt "$BASE"/releases/*/ | tail -n +4 | xargs -r rm -rf
  echo "== Done: the website is running the new version."
else
  echo "The new version didn't start. Going back to the one before."
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$NEW" ]; then
    ln -sfn "$PREVIOUS" "$BASE/current.next" && mv -Tf "$BASE/current.next" "$BASE/current"
    systemctl restart shadowcrypts
  fi
  journalctl -u shadowcrypts -n 30 --no-pager || true
  exit 1
fi
