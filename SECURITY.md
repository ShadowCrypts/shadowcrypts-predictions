# Security

<img src="public/signature-720.webp" width="280" alt="ShadowCrypt signature: a hooded figure with glowing eyes, drawn in purple text characters">

## Reporting a problem

If you find a vulnerability in the code, report it privately through GitHub: this repository's **Security** tab, then **Report a vulnerability**. Please don't open a public issue for it. For a problem with a particular running copy of the site, use the contact in its `/.well-known/security.txt` (served when its owner sets `SECURITY_CONTACT`). Please don't test against someone else's deployment beyond what's needed to show the problem.

## What the site is

A self-hosted Next.js 16 app: no accounts, no passwords, no payments, no cookies, no server actions, and no forms posting to pages (the one form, feedback, sends JSON to `/api/feedback`). Everything a visitor saves (parlays, picks, followed teams, settings) stays in their own browser, except what they choose to send: for background alerts, a browser push address and the parlays and teams to watch; and feedback messages, with a way to reach them only if they give one (`.cache/feedback/`, owner-only, a size cap a month, 5 messages per address an hour). The server also keeps daily visit totals (no IP addresses, cookies or fingerprints). The site's `/privacy` page lists all of it in plain words. Data comes from ESPN's public feeds.

## Protections

- **Content Security Policy** with a fresh nonce per page: only this site's scripts run, images only from here and ESPN's image service, connections only to this site, no framing, no plugins. Violations are reported to `/api/csp-report` and logged.
- **Headers on every response**, including those the proxy answers itself: HSTS (with subdomains, preload-ready), `nosniff`, `X-Frame-Options: DENY`, strict referrer policy, a Permissions-Policy that turns off hardware and payment features, `Cross-Origin-Opener-Policy`, no `X-Powered-By`.
- **One gate for every request** (`proxy.ts`), build output and the fixed public files (service worker, offline page, robots.txt, manifest) aside: per-client rate limits (pages, router prefetches, API, costly endpoints and images drawn on request), a cap per costly endpoint for everyone together, pages by GET/HEAD only, and a 404 of the proxy's own for any address that can't be a page (JSON under `/api/`), before the app runs.
- **Input**: ids in URLs match strict patterns, lists are capped, request bodies are read only up to a small cap (and Next.js keeps at most 64 KB of any body), JSON endpoints take JSON from the site's own pages only, and push alerts go only to the browsers' own push services. Nothing a link or request says is reflected into a page.
- **Secrets**: the VAPID key that signs alerts lives in `.cache/` (owner-only on Unix), or in `VAPID_PRIVATE_KEY`; `.cache/` and every `.env` file are kept out of git and Docker images.
- **Network**: `npm run start`, `npm run serve` and `npm run dev` listen on 127.0.0.1 only; Docker publishes on 127.0.0.1 unless `WEB_BIND` says otherwise.
- **Dependencies**: `npm audit` clean, and all 511 packages' registry signatures verified (`npm audit signatures`).
- **Checks that keep it so**: `tests/security.test.ts`, `tests/push.test.ts`, `tests/routes.test.ts` (`npm run verify`), and about 550 end-to-end checks against a running server (`npm run smoke`), which CI can't run because they need a live server and ESPN's feeds.

## Deploying publicly

1. Put it behind HTTPS (Tailscale Serve, a Cloudflare Tunnel, Caddy or a host that provides it) and set `SITE_URL` to that address.
2. Set `TRUST_PROXY_HOPS=1` (one per proxy that adds `X-Forwarded-For`), so rate limits key on real client addresses. Without a proxy in front, a client can claim any address; the per-endpoint caps still hold.
3. In the reverse proxy, cap request bodies (64 KB is plenty) and request time: Next.js reads a request's whole body before the proxy sees it, so a slow upload can hold a connection for up to Node's five-minute timeout.
4. Set `SECURITY_CONTACT` (and optionally `VAPID_SUBJECT`).
5. Run `npm audit` before each deploy.

## Audit log

**2026-11-15, fourth round: trying to take the site offline.** Bounded tests, each timed against a normal visitor's page load, not floods (a real flood from thousands of machines is Cloudflare's to absorb, and testing that from one is neither meaningful nor fair to the networks in between). The memory crash from round three, retried on the live server with the fix in: 2,000 old NBA and NHL game pages at 4 a second, the most a client is allowed, held the site's memory at 1.28–1.31 GB from start to end while a normal visitor's page kept loading in 0.16–0.28 s. Found and fixed:

| Finding | Severity | Fix |
| --- | --- | --- |
| Port 80 at the origin was open to everyone, and Caddy's automatic HTTP-to-HTTPS server there doesn't take the Caddyfile's timeouts: 40 connections that never finished a request were all still held after 60 s, so one client could pile up open connections for good | Low | While the domain is proxied, port 80 takes only Cloudflare's addresses, like 443 (`firewall.sh`). Let's Encrypt's checks come through Cloudflare; Cloudflare only ever forwards whole requests |

**2026-11-15, third round: a targeted attacker who has read the code.** Held: JavaScript's built-in names (`__proto__`, `constructor`, `toString` …) in every query parameter a page or API reads (114 probes, no errors), the service worker (same-origin only; notification links must be paths on this site), the CSP (no loopholes), and hand-written requests to the origin's port 80 (Host spoofing, absolute-form and `CONNECT` requests, CL/TE smuggling: Caddy only ever redirects to HTTPS there and never reaches the app). Found and fixed:

| Finding | Severity | Fix |
| --- | --- | --- |
| The in-memory cache never let anything go: each old game page opened (by a crawler, or on purpose) held about 1 MB for good, measured at 879 → 948 MB over 80 pages on the live server, so 1,500–2,000 pages would have run the 2.2 GB heap out and crashed the site, repeatably | High | A least-recently-used cap of 1,500 entries (`MEMORY_LIMIT`), persisted entries reloading from disk. A local crawl of 2,400 old game pages now levels off at about 1.2 GB |
| `/api/sweat` read any of ~14,000 past games' play by play from ESPN on demand (40 a request) and kept each: a walk through the history meant thousands of ESPN reads through the lane the site's own data uses, and the memory above | Medium | Games from the last three days only, at most 12 a request (`SWEAT_WINDOW_MS`, `SWEAT_MAX_GAMES`); `/api/legs` reads at most 12 new box scores from ESPN a request (`LEG_FETCHES`) |
| The rate limiter cleared its whole table at 50,000 keys: holding enough addresses (an IPv6 /48) let anyone reset every client's count, their own included | Medium | Past the cap it drops the tenth with the fewest hits, so a busy or refused client keeps its count (tested against 5,000 one-off addresses) |
| A forged `Referer: https://constructor/` turned the day's "where visitors came from" count into text that grew each minute, and `__proto__` vanished from it | Low | Own keys only, `__proto__` stored under another spelling, non-numbers ignored when adding up |
| Fighter flag images were taken from the feed as given | Low | Only `https://a.espncdn.com/` addresses are kept (the CSP already blocked others) |

**2026-11-15, second round: trying to take the server.** Every route to code execution or root, attacker-style but non-destructive. Held: the 2025 React Server Components / server-action RCE family ("React2Shell") posted with flight and multipart payloads to 14 kinds of address, including the files the proxy skips (Cloudflare's managed rules answer 403; the proxy answers 405 behind them, as the first round showed); Next.js internal headers (`x-nextjs-data`, `x-invoke-path`, router state, `x-middleware-subrequest`); encoded and double-encoded traversal into `_next/static`, `.next/` and dev-only endpoints; Cloudflare cache poisoning and cache deception; prototype pollution and 9,000-deep nesting in JSON bodies; 14 SSRF disguises on the push endpoint (homoglyphs, userinfo, suffix, fragment, trailing dot, decimal and IPv6 hosts, ports, backslashes); slow inputs (every probe answered in under 0.3 s); oversized headers. Code review found no HTML or code sinks beyond the fixed theme script and escaped JSON-LD, no child processes, and ESPN as the only outbound host. On the server: OpenSSH 9.6p1-3ubuntu13.20 (past regreSSHion and the 2025 fixes), no unusual setuid files, the site's user can't write anywhere root runs things. Found and fixed:

| Finding | Severity | Fix |
| --- | --- | --- |
| Node.js was one security release behind (24.22.2, with 24.22.3 out): it comes from nodejs.org, so Ubuntu's automatic updates never patch it | Medium | `node-update.sh` installs the newest 24 release now and every Monday, checksum checked, restarting the site on it and rolling back if it doesn't come up |
| `update-site` (root) cleared old versions with `ls … \| xargs rm -rf` in a folder the site's user owns: after a compromise of the site, a folder named `x /etc` would have had root delete `/etc` on the next update | Medium | The top folder and the list of versions belong to root; only folders named like a release timestamp are removed, one at a time (tested against that name) |
| Rate limits keyed IPv6 visitors by full address: one connection's /64 holds billions, a fresh allowance each | Low | IPv6 is keyed by its /64 (`addressKey`) |
| Caddy's own repository isn't in Ubuntu's automatic updates | Low | Added to them |
| SSH still offered SHA-1 and 64-bit MACs, NIST curves and group14 key exchange | Low | Modern key exchange (with the post-quantum hybrid), AEAD ciphers and SHA-2 ETM MACs only |

What's left is outside the server: whoever holds the GitHub, Cloudflare, Contabo or email account can change the site without touching any of this, so each should have two-factor sign-in.

**2026-11-15, owner-run penetration test of the live site and server.** Non-destructive: about 90 web checks (secret and source files, path tricks, reflected input in every page and API parameter, open redirects, methods, the `x-middleware-subrequest` bypass, forged host and IP headers, CORS, write endpoints, error output, TLS versions), a rate-limit test with a new forged `X-Forwarded-For` on each of 135 requests, a port check of the origin, and a read-only review of the server. Passed: nothing secret or internal is served, no input is reflected unescaped, no open redirects, the proxy can't be skipped, forged IP headers don't move the rate limit (blocked at request 121) and Cloudflare refuses a forged `CF-Connecting-IP` outright, only ports 22 and 80 answer at the origin (443 is Cloudflare-only), SSH refuses passwords. Found and fixed:

| Finding | Severity | Fix |
| --- | --- | --- |
| A kernel security update was installed but waiting on a restart | Medium | Updates that need a restart now get one at 04:45 (`Automatic-Reboot`); this one was scheduled the same night |
| The site's service sandbox scored 8.4 ("exposed") in `systemd-analyze security` | Low | Read-only system, no devices, kernel or clock access, no capabilities, own address families only, `UMask=0027`: 3.0. Applied with a health check that restores the old settings if the site doesn't come back |
| About 1,000 failed SSH logins a day from robots (keys only, so none could succeed) | Low | fail2ban bans an address after 5 failures for an hour, longer on repeat; SSH allows 3 tries and no port, agent or X11 forwarding |
| The image's default `ubuntu` account had passwordless sudo (locked password, no key, never used) | Low | Locked, expired and given no shell |
| Backups and records were readable by other local accounts | Low | Only the site's user can read `shared/` and `backups/`; backups are written owner-only |
| Cloudflare accepted TLS 1.0 and 1.1; no SPF or DMARC (anyone could send mail "from" the domain); DNSSEC off | Low | Cloudflare settings: minimum TLS 1.2, `v=spf1 -all` and a `p=reject` DMARC record (the domain sends no mail), DNSSEC on |

**2026-11-11, outside review of the live site.** Found and fixed:

| Finding | Severity | Fix |
| --- | --- | --- |
| Next.js 16.4.3 was in the range of seven advisories fixed in 16.4.5 (Nov 3), which `npm audit` didn't list yet. None reached this site: it has no `use cache` or `unstable_cache`, no Edge routes and image optimization off, and returns no fetched response as it is | Medium | Next.js 16.4.6 |
| Cloudflare's protection could be skipped by using the server's own address, which was public in DNS before the proxy went on | Medium | While the domain is proxied, the firewall lets only Cloudflare reach port 443, rechecked every 10 minutes (`deploy/firewall.sh`) |
| One address could sign up alert lists from many browsers until the store's 2,000 cap pushed the oldest real ones out (each sign-up must already be a working push subscription for this site's key) | Low | At most 10 browsers new to the server per address an hour, counted in memory only |
| Unknown `/api/` addresses got the app's HTML not-found page, without the nonce policy pages carry | Low | A JSON 404 from the proxy (`isKnownApi`, kept in step with `app/api` by a test) |
| HSTS without `includeSubDomains` or `preload` | Low | Both added (every name under the domain is HTTPS) |
| `Via: 1.1 Caddy` and `Server: Caddy` named the origin's web server | Info | Removed in the Caddyfile |
| Some API answers had no `Cache-Control` | Info | Each says how long it can be kept |

Confirmed already in place: alerts go only to the browsers' own push services (`https:` and a fixed list of hosts, no ports or credentials in the address), so a sign-up can't point the server at an internal address.

**2026-10-28, full audit.** Found and fixed:

| Finding | Severity | Fix |
| --- | --- | --- |
| POST endpoints read request bodies whole before checking size (a chunked upload has no length to check): five 200 MB uploads at once grew the server's memory by 160 MB and left it 121 MB larger (45 MB after the fix) | High | Bodies read up to a cap and cut off (`lib/http.ts`); Next.js's own body copy capped at 64 KB (`proxyClientMaxBodySize`) |
| Addresses with a dot (`/wp-login.php`, `/.env`) skipped the proxy: no security policy, no rate limit, and each still rendered the app | High | Proxy runs for everything but build output and the two real public files |
| `npm run start`/`dev` listened on every interface, reachable over the LAN and the VPN adapter | Medium | 127.0.0.1 by default (`HOST` / `WEB_BIND` to open up on purpose) |
| Pages accepted POST/PUT/DELETE, reaching Next.js's server-action handling though the site has none | Medium | 405 for anything but GET/HEAD on pages |
| The not-found rewrite looped through the proxy when the request's host differed from the server's bind address (any reverse proxy), until rate-limited, then failed after 30 s | Medium | The proxy answers unknown addresses itself; no rewrite |
| New push subscriptions were stored before being proven, so junk could fill the list and push real browsers out | Medium | A new subscription is kept only after its push service accepts an alert |
| One shared global cap on costly endpoints: flooding one (the CSP report endpoint) starved the others (parlay tracking) | Low | A separate cap per endpoint; share images counted as costly |
| `.cache/` (with the alert signing key) and `.env` not ignored by git; `.env` copied into Docker images | Low | Both ignored; the key file is owner-only |
| Calendar feed marked publicly cacheable while its links can come from the request | Low | `private` caching; carriage returns escaped |
| Alert scan cost grew with the number of subscriptions | Low | At most 5,000 legs per scan |
| Two writes of one cache file at once shared a temporary file name | Low | Unique temporary names |

Checked and fine: no known-vulnerable dependencies; the 2025 `x-middleware-subrequest` bypass doesn't reach the proxy; the `Host` header isn't reflected; no `eval`, no raw HTML from outside data (the two inline scripts are the fixed theme script and escaped JSON-LD), no open redirects, cookies or server actions; logs carry no client addresses, identifying headers or query strings; JSON-LD and calendar output are escaped; push links stay on this site.
