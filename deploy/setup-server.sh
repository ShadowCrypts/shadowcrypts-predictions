#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for ShadowCrypts Predictions. Run as root, from this
# folder copied onto the server:  bash setup-server.sh
#
# What it does, in order: updates the system and turns on automatic security updates; adds a little swap
# for builds; installs Node.js 24 (the official build, checksum checked) and Caddy (the web server that
# handles HTTPS, from Caddy's own repository); makes a "shadowcrypts" user that runs the site with no admin
# rights; lays out /srv/shadowcrypts; installs the `update-site` command, the service that keeps the site
# running and the nightly backup; opens only SSH, HTTP and HTTPS in the firewall (HTTPS only from Cloudflare
# while the domain goes through its proxy, see firewall.sh); turns off password logins over SSH (keys only)
# and shuts out addresses that keep failing (fail2ban); locks the image's unused default account; and lets
# security updates restart the server at 04:45 when they need to. It's safe to run again: each step checks
# what's already done.
#
# It doesn't put the site itself up: run `update-site` after it for that.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

DOMAIN="${DOMAIN:-shadowcrypts.com}"
REPO="${REPO:-https://github.com/ShadowCrypts/shadowcrypts-predictions.git}"
APP=shadowcrypts
BASE=/srv/shadowcrypts
HERE="$(cd "$(dirname "$0")" && pwd)"

step() { printf '\n== %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then echo "Run this as root." >&2; exit 1; fi

step "System updates, and automatic security updates from now on"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install git curl ca-certificates xz-utils ufw gnupg dnsutils debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades fail2ban
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
# An update that needs a restart (a new kernel) gets one, at a quiet hour, so fixes don't sit waiting.
cat > /etc/apt/apt.conf.d/52shadowcrypts-reboot <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:45";
EOF

step "Clock on US Eastern time, like the site's schedules (logs and the nightly backup go by it)"
timedatectl set-timezone "${TIMEZONE:-America/New_York}"
date

step "Swap, so a build never runs out of memory"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon --show

step "Node.js 24 (official build from nodejs.org, checksum checked)"
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/SHASUMS256.txt" https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
  file="$(grep -oE 'node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' "$tmp/SHASUMS256.txt" | head -1)"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/latest-v24.x/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --no-same-owner \
    --exclude='CHANGELOG.md' --exclude='LICENSE' --exclude='README.md'
  rm -rf "$tmp"
fi
echo "node $(node --version), npm $(npm --version)"

step "Caddy (the web server: HTTPS certificates are automatic), from Caddy's official repository"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get -y -q install caddy
fi
caddy version

step "The '$APP' user, which runs the site without admin rights"
id -u "$APP" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP" --shell /usr/sbin/nologin "$APP"
mkdir -p "$BASE/releases" "$BASE/shared/.cache" "$BASE/backups"
if [ ! -f "$BASE/shared/.env" ]; then
  cat > "$BASE/shared/.env" <<EOF
SITE_URL=https://$DOMAIN
# The visitor's address is the second from the end of X-Forwarded-For: Cloudflare's goes last. A request
# straight to the server has only one entry (Caddy replaces anything else), and it's still picked.
TRUST_PROXY_HOPS=2
HOST=127.0.0.1
PORT=3000
VAPID_SUBJECT=https://github.com/ShadowCrypts/shadowcrypts-predictions
SECURITY_CONTACT=https://github.com/ShadowCrypts/shadowcrypts-predictions/security/advisories/new
EOF
fi
# (Servers set up before Cloudflare's proxy said 1: bring them along, and restart the site to read it.)
if grep -q '^TRUST_PROXY_HOPS=1$' "$BASE/shared/.env"; then
  sed -i 's/^TRUST_PROXY_HOPS=1$/TRUST_PROXY_HOPS=2/' "$BASE/shared/.env"
  if systemctl is-active --quiet shadowcrypts; then systemctl restart shadowcrypts; fi
fi
chmod 640 "$BASE/shared/.env"
chown -R "$APP:$APP" "$BASE"
# The site's data and backups (feedback can hold a way to reach someone) are for the site's user only.
chmod -R o-rwx "$BASE/shared" "$BASE/backups"
echo "$BASE: releases/ (each version of the site), shared/.cache (its data), shared/.env (settings), backups/"

step "The update-site command, the service and the nightly backup"
sed -e "s#__REPO__#$REPO#" "$HERE/update-site.sh" > /usr/local/bin/update-site
chmod 755 /usr/local/bin/update-site
unit=/etc/systemd/system/shadowcrypts.service
unit_changed=0
if [ -f "$unit" ] && ! cmp -s "$HERE/shadowcrypts.service" "$unit"; then
  cp "$unit" /root/shadowcrypts.service.previous
  unit_changed=1
fi
install -m 644 "$HERE/shadowcrypts.service" "$unit"
cat > /etc/cron.d/shadowcrypts-backup <<EOF
# Every night: the records that can't be downloaded again (locked forecasts, logged picks, feedback), kept 30 days.
17 4 * * * $APP umask 077 && cd $BASE/shared/.cache && tar -czf $BASE/backups/records-\$(date +\%F).tgz --ignore-failed-read ledger prop-ledger espn-ledger fantasy-ledger.json ufc-ledger.json movement odds-history feedback 2>/dev/null; find $BASE/backups -name 'records-*.tgz' -mtime +30 -delete
EOF
systemctl daemon-reload
systemctl enable shadowcrypts >/dev/null
# New service settings (its sandbox) take effect on a restart. If the site doesn't come back healthy under them
# within two minutes, the old settings go back and the site restarts on those: never left down.
if [ "$unit_changed" = 1 ] && systemctl is-active --quiet shadowcrypts; then
  echo "The site's service settings changed: restarting it to use them..."
  systemctl restart shadowcrypts
  healthy=0
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null --max-time 3 http://127.0.0.1:3000/api/health; then healthy=1; break; fi
    sleep 2
  done
  if [ "$healthy" = 1 ]; then
    echo "The site is back up under the new settings."
  else
    echo "The site didn't come back under the new settings: putting the old ones back."
    install -m 644 /root/shadowcrypts.service.previous "$unit"
    systemctl daemon-reload
    systemctl restart shadowcrypts
  fi
fi

step "Caddy's settings for $DOMAIN"
# HTTPS only once the domain points here: Let's Encrypt locks a name out for a while after a few failed
# tries, and every try fails until then. Meanwhile the site answers on plain HTTP at the server's address.
here_ip="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
# Ask a public resolver, as Let's Encrypt effectively does: the host's own (the provider's) can go on
# answering "no such name" for an hour after the record goes in. (No answer yet is an answer, not an error.)
dns_ip="$(dig +short @1.1.1.1 "$DOMAIN" A 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)"
[ -n "$dns_ip" ] || dns_ip="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR == 1 {print $1}' || true)"
cf_ranges="$( { curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4; echo; curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6; } 2>/dev/null | grep -E '^[0-9a-f:.]+/[0-9]+$' | tr '\n' ' ' || true)"
if [ -z "$cf_ranges" ]; then
  # Without the list nobody's forwarded address is trusted: still safe, but behind Cloudflare every visitor would look alike.
  cf_ranges="private_ranges"
  echo "Couldn't fetch Cloudflare's address list; run this again before turning Cloudflare's proxy on."
fi
# Through Cloudflare's proxy, the name resolves to one of Cloudflare's addresses instead of this server's.
cf_on_dns="$(python3 -c 'import ipaddress, sys
ip = ipaddress.ip_address(sys.argv[1])
print(int(any(ip in ipaddress.ip_network(n) for n in sys.argv[2:])))' "${dns_ip:-0.0.0.0}" $cf_ranges 2>/dev/null || echo 0)"
if [ -n "$dns_ip" ] && { [ "$dns_ip" = "$here_ip" ] || [ "$cf_on_dns" = 1 ]; }; then
  sed -e "s/shadowcrypts\.com/$DOMAIN/g" -e "s#__CLOUDFLARE_RANGES__#$cf_ranges#" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
  if [ "$cf_on_dns" = 1 ]; then echo "$DOMAIN goes through Cloudflare's proxy: HTTPS on, Cloudflare's addresses trusted."; else echo "$DOMAIN points here ($here_ip): HTTPS on."; fi
else
  printf ':80 {\n\treverse_proxy 127.0.0.1:3000\n}\n' > /etc/caddy/Caddyfile
  echo "$DOMAIN doesn't point here yet (it points to: ${dns_ip:-nothing}; this server is $here_ip)."
  echo "For now the site is on http://$here_ip. Once the domain points here, run this setup again to turn on HTTPS."
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

step "Firewall: only SSH, HTTP and HTTPS (HTTPS only from Cloudflare while the domain goes through it)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw --force enable >/dev/null
sed -e "s#__DOMAIN__#$DOMAIN#" "$HERE/firewall.sh" > /usr/local/sbin/shadowcrypts-firewall
chmod 755 /usr/local/sbin/shadowcrypts-firewall
/usr/local/sbin/shadowcrypts-firewall
# Every 10 minutes: follows the domain on or off Cloudflare's proxy, and Cloudflare's list of addresses.
cat > /etc/cron.d/shadowcrypts-firewall <<'EOF'
*/10 * * * * root /usr/local/sbin/shadowcrypts-firewall >/dev/null 2>&1
EOF
echo "$(ufw status | head -1). SSH and port 80 open to all; port 443 $(if ufw status | grep -qE '^443/tcp +ALLOW +Anywhere'; then echo 'open to all'; else echo "only from Cloudflare ($(ufw status | grep -c '# cloudflare$') rules)"; fi)."

step "SSH: keys only, no passwords, nothing extra"
cat > /etc/ssh/sshd_config.d/10-shadowcrypts.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
# Logging in and copying files is all it's for: no forwarding of ports, agents or screens.
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
MaxAuthTries 3
LoginGraceTime 30
EOF
sshd -t
systemctl reload ssh

step "fail2ban: an address that keeps failing to log in is shut out for a while"
# Keys can't be guessed, but robots try all day; this stops them filling the logs and using the connection.
cat > /etc/fail2ban/jail.d/shadowcrypts.conf <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
bantime.increment = true
bantime.maxtime = 1w
EOF
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban
sleep 2
fail2ban-client status sshd 2>/dev/null | grep -E 'Currently banned|Total failed' | sed 's/^[^A-Z]*//' || echo "fail2ban: starting"

step "Unused accounts"
# The image's default "ubuntu" login has no password or key and isn't used: switched off for good.
if id ubuntu >/dev/null 2>&1 && [ ! -s /home/ubuntu/.ssh/authorized_keys ]; then
  usermod --lock --shell /usr/sbin/nologin --expiredate 1 ubuntu
  echo "ubuntu: locked"
fi
# Helper scripts copied up for one-off checks.
rm -f /root/remote-*.sh

if [ -f /var/run/reboot-required ]; then
  # A security update waiting on a restart: tonight at 04:45, when hardly anyone is on (about a minute down).
  shutdown -r 04:45 "Restarting to finish security updates" >/dev/null 2>&1 || true
  echo "A security update needs a restart: scheduled for 04:45 tonight (Eastern)."
fi

step "Done. Next: put the site's data in $BASE/shared/.cache if you have some, then run: update-site"
