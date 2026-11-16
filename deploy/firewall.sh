#!/usr/bin/env bash
# While the domain goes through Cloudflare's proxy (the orange cloud), only Cloudflare may reach this server's web
# ports, 80 and 443, so nobody can go around Cloudflare's protection by using the server's own address. Port 80
# included: Let's Encrypt's certificate checks come through Cloudflare like everyone else, and left open to all
# it let a client hold connections open for good (Caddy's automatic redirect server on 80 doesn't take the
# timeouts in the Caddyfile), where Cloudflare only ever passes on whole requests.
# If the domain stops going through Cloudflare (the grey cloud), both ports open to everyone again by themselves.
#
# setup-server.sh installs this as /usr/local/sbin/shadowcrypts-firewall and runs it every 10 minutes. It only
# ever touches the rules for ports 80 and 443; SSH is left alone.
set -uo pipefail

DOMAIN="${DOMAIN:-__DOMAIN__}"
STATE=/var/lib/shadowcrypts
LIST="$STATE/cloudflare-ranges"
PORTS="80 443"
mkdir -p "$STATE"

# Cloudflare's addresses, fetched again once a day. A failed or short download keeps the last good list
# (Cloudflare has had 15 IPv4 ranges for years; fewer than 10 means something went wrong).
if [ ! -s "$LIST" ] || [ -n "$(find "$LIST" -mmin +1440 2>/dev/null)" ]; then
  fresh="$( { curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4; echo; curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6; } 2>/dev/null | grep -E '^[0-9a-f:.]+/[0-9]+$' || true)"
  if [ "$(printf '%s\n' "$fresh" | grep -c '\.' || true)" -ge 10 ]; then printf '%s\n' "$fresh" > "$LIST"; fi
fi

open_rule() { ufw status | grep -qE "^$1/tcp +ALLOW +Anywhere"; }
cloudflare_rules() { ufw status | grep '# cloudflare$' | grep -E "^$1/tcp " | grep -oE '[0-9a-f:.]+/[0-9]+' | sort -u; }
open_to_all() {
  for port in $PORTS; do
    open_rule "$port" || { ufw allow "$port/tcp" >/dev/null && echo "Port $port open to everyone ($DOMAIN isn't behind Cloudflare's proxy)."; }
    for r in $(cloudflare_rules "$port"); do ufw delete allow proto tcp from "$r" to any port "$port" >/dev/null; done
  done
}

# Where the name points, asked of a public resolver (the provider's own can lag behind).
ip="$(dig +short +time=5 +tries=2 @1.1.1.1 "$DOMAIN" A 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)"
if [ -z "$ip" ]; then
  # No answer: keep whatever is set up, and with nothing set up yet for a port, the safe default of open.
  for port in $PORTS; do
    if ! open_rule "$port" && [ -z "$(cloudflare_rules "$port")" ]; then ufw allow "$port/tcp" >/dev/null; fi
  done
  exit 0
fi
if [ ! -s "$LIST" ]; then
  echo "No list of Cloudflare's addresses yet: the web ports stay as they are."
  exit 0
fi
ranges="$(cat "$LIST")"
proxied="$(python3 -c 'import ipaddress, sys
ip = ipaddress.ip_address(sys.argv[1])
print(int(any(ip in ipaddress.ip_network(n) for n in sys.argv[2:])))' "$ip" $ranges 2>/dev/null || echo 0)"

if [ "$proxied" != 1 ]; then
  open_to_all
  exit 0
fi

# Behind Cloudflare: allow each of its ranges first, then close the door for everyone else, port by port.
for port in $PORTS; do
  have="$(cloudflare_rules "$port")"
  for r in $ranges; do
    printf '%s\n' "$have" | grep -qxF "$r" || ufw allow proto tcp from "$r" to any port "$port" comment cloudflare >/dev/null
  done
  for r in $have; do
    printf '%s\n' "$ranges" | grep -qxF "$r" || ufw delete allow proto tcp from "$r" to any port "$port" >/dev/null
  done
  if open_rule "$port"; then
    ufw delete allow "$port/tcp" >/dev/null
    echo "Port $port now reaches the server only through Cloudflare."
  fi
done
exit 0
