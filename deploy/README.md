# Deploying to a server

How the live site runs: one small Ubuntu 24.04 server, with Caddy in front for HTTPS and the site built from
this GitHub repository. Any provider works; it needs about 1 GB of memory free for the site (it uses about
600 MB, and briefly more while starting fresh or building) and a persistent disk.

## First time

1. Copy this folder onto the server and run the setup as root:

   ```bash
   scp -r deploy root@SERVER:/root/
   ```

   ```bash
   ssh root@SERVER "bash /root/deploy/setup-server.sh"
   ```

   It installs Node.js 24 and Caddy, creates a `shadowcrypts` user that runs the site without admin
   rights, turns on the firewall and automatic security updates, and turns off password logins over SSH:
   make sure your SSH key works first. `DOMAIN=example.com` and `REPO=https://github.com/you/fork.git` in
   front of the command point it at your own domain and fork.

2. If you have data from another copy, put it in `/srv/shadowcrypts/shared/.cache` (owned by the
   `shadowcrypts` user). The locked forecasts and logged picks can't be downloaded again (see
   [OPERATIONS.md](../docs/OPERATIONS.md#on-a-server)). Without it, `npm run warm` fills the rest in about
   half an hour.

3. Put the site up:

   ```bash
   ssh root@SERVER update-site
   ```

4. Point the domain's DNS at the server (an A record for the name and for `www`), then run the setup
   again: it turns on HTTPS once the name points there.

5. Optional: Cloudflare's proxy in front (the orange cloud). Set Cloudflare's SSL/TLS mode to
   **Full (strict)** first (anything less loops on redirects), then switch both records to Proxied. The
   setup has already told Caddy to trust Cloudflare's addresses (fetched from cloudflare.com/ips each
   run) and set `TRUST_PROXY_HOPS=2`, so each visitor is still known by their own address; it works with
   the proxy off too. Keep Rocket Loader and automatic Web Analytics off: anything Cloudflare injects
   into pages is blocked by the site's Content Security Policy.

   With the proxy on, the firewall lets only Cloudflare's addresses reach port 443, so nobody can get
   around Cloudflare by using the server's own address (`firewall.sh`, run every 10 minutes). Port 80
   stays open for Let's Encrypt's certificate checks and redirects to HTTPS. Turning the proxy off again
   (grey cloud) is fine: within 10 minutes the firewall notices and opens 443 to everyone.

## Updating

Push to GitHub, then:

```bash
ssh root@SERVER update-site
```

It builds the new version next to the running one, switches over with a restart of a few seconds, checks
the site answers, and goes back to the previous version by itself if it doesn't. The last three versions
are kept in `/srv/shadowcrypts/releases`.

## On the server

| What | Where |
| --- | --- |
| The running version | `/srv/shadowcrypts/current` (a link to one of `releases/`) |
| The site's data | `/srv/shadowcrypts/shared/.cache` |
| Settings (SITE_URL, keys) | `/srv/shadowcrypts/shared/.env` |
| Nightly backups of the records | `/srv/shadowcrypts/backups` (30 days) |
| Logs | `journalctl -u shadowcrypts -f`, and the last build in `/var/log/shadowcrypts-build.log` |
| Firewall | `ufw status`; port 443 follows the domain on or off Cloudflare (`shadowcrypts-firewall`) |
| Visitor counts | `cd /srv/shadowcrypts/current && npm run visits` |
| Feedback messages | `cd /srv/shadowcrypts/current && npm run feedback` (kept in `shared/.cache/feedback`, in the nightly backup) |

The backups are on the same server, so they guard against mistakes, not against losing the server: copy
them somewhere else now and then.
