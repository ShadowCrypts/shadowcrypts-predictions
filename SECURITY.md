# Security

<img src="public/signature-720.webp" width="280" alt="ShadowCrypt signature: a hooded figure with glowing eyes, drawn in purple text characters">

## Reporting a problem

If you find a vulnerability in the code, report it privately through GitHub: this repository's **Security** tab, then **Report a vulnerability**. Please don't open a public issue for it. For a problem with a particular running copy of the site, use the contact in its `/.well-known/security.txt` (served when its owner sets `SECURITY_CONTACT`). Please don't test against someone else's deployment beyond what's needed to show the problem.

## What the site is

A self-hosted Next.js 16 app: no accounts, no passwords, no payments, no cookies, no forms or server actions. Everything a visitor saves (parlays, picks, followed teams, settings) stays in their own browser, except what they choose to send for background alerts: a browser push address and the parlays and teams to watch. The server also keeps daily visit totals (no IP addresses, cookies or fingerprints). The site's `/privacy` page lists all of it in plain words. Data comes from ESPN's public feeds.

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
