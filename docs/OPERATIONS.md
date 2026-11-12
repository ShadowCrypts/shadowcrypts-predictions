# Running it

Setup, every script, keeping forecasts locked close to game time, hosting, security and the quality bar. Back to the [README](../README.md).

## Setup

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. The first load downloads three seasons per league and can take a minute; after that it's cached. The dev and production servers listen on this computer only (127.0.0.1); to open one to your home network on purpose, run `npm run serve` with `HOST=0.0.0.0`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run warm` | Pre-downloads every season and closing line so page loads never have to. |
| `npm run refresh` | Keeps logged forecasts current so they lock close to game time (see below). Runs until stopped. |
| `npm run backtest` | Prints the out-of-sample record per league: forecast, pre-line, Elo alone, market alone. |
| `npm run backtest -- --grid` | Also re-tunes Elo, the market blend and the pre-line settings on the first graded season. |
| `npm run backtest -- --props` | Tunes each league's player projections on its first graded season, then compares later seasons with season and last-10 averages, the sportsbooks' prop lines (closing and opening), and betting the model's disagreements by market. Add `--league=nhl` for one league. Run `npm run warm` first to download box scores and prop history. |
| `npm run backtest -- --live-props` | NBA, NHL and NFL: rebuilds each graded player's stats period by period from play-by-play (downloaded once, stored in `.cache/`), fits the live prop chance on the earlier half of games and tests it on the later half against the pregame chance and plain time-left scaling (in the NFL also without game script), by market, plus same-game pairs mid-game. Add `--league=nfl` for one league. |
| `npm run backtest -- --alt-lines` | Fits how much each stat spreads around the book's line on the earlier half of graded lines and checks the chances at other lines on the later half, against outcomes and the book's own alternate prices. Also checks for an over lean on main lines. Add `--league=nba` for one league. |
| `npm run backtest -- --correlations` | Fits how one game's props and result move together on the earlier half of games with graded lines and tests same-game parlay chances on the later half. Add `--write` to save the table fitted on every graded game to `lib/model/correlationTable.ts`, and `--league=nba` for one league. |
| `npm run backtest -- --scores` | Tunes the projected-score model on the first graded season and compares later seasons with the posted spread, over/under and league average. |
| `npm run backtest -- --fantasy` | NFL fantasy: each week's projected points against what players scored, next to their season average and last three games, by season and position, plus the touchdown prior, the correction by position and the ranges the page shows. |
| `npm test` | Unit tests: the model math (metrics, market, Elo, lineups, live win probability, props, parlays, play-by-play) and the security policy, headers and rate limits. |
| `npm run lint` | ESLint 9 with Next.js's rules, including the React Compiler checks (`eslint.config.mjs`). |
| `npm run verify` | Type check, lint and every unit test in one go: run it before each build. |
| `npm run smoke` | Against a running production server: about 450 end-to-end checks. Every page loads with its security headers and a nonce on every script, metadata sits in `<head>`, each page has one main heading, unknown addresses (dotted ones too) are real 404s, pages refuse anything but GET, the API answers and refuses what it should (oversized and streamed bodies included), and the static files and the security report endpoint behave. Exits 1 on any failure. `-- --base=https://…` for another server. |
| `npm run datacheck` | The numbers themselves, against a running production server: records, scores, the schedule, stat leaders, rosters and player game logs against ESPN's own feeds, and arithmetic that has to hold whatever the source (a forecast's factors add up to it, playoff odds add up to the playoff spots, the track record and prop profit recount from the graded files). Exits 1 on any disagreement; `-- --only=nba` for one league. |
| `npm run audit` | Lighthouse (performance, accessibility, best practices, SEO) on the main pages, phone and desktop, against a running production server, with every check under 90 listed. Full reports in `.cache/audits/`. `-- --min=95` fails if any score is lower; `-- --only=/live` for one page. |
| `npm run visits` | How many people are arriving, where they land and which sites send them: the daily totals in `.cache/visits/` (`-- --days=60` for longer). An arrival is a person opening a page; moving around inside the site isn't counted, and robots and link previews get a total of their own underneath, with why they were set aside. Totals only: no IP addresses, cookies or fingerprints (`lib/visits.ts`). |
| `npm run feedback` | The messages sent from the site's Feedback button, newest first (`-- --days=90`, `-- --all`): kind, page, text, and a way to reply if the sender gave one. Kept in `.cache/feedback/<month>.jsonl`; delete a line to delete a message. |
| `npm run build` / `npm run start` | Production build and server. Stop `npm run dev` first; they share the `.next` folder. |
| `npm run serve` | The production site plus the refresher in one window, each restarted if it crashes. Ctrl+C stops both. Needs `npm run build` first. |
| `npm run prod` | `npm run build`, then `npm run serve`. |

## Locking forecasts close to game time

A forecast is logged each time a league's model is rebuilt within 48 hours of a game, and the last one logged before the scheduled start is the one that gets graded. The site only rebuilds when someone opens a page, so without help a forecast can lock a day or more early and miss late injury news and line moves. The refresher rebuilds each league every 10 minutes while any of its games starts within 3 hours, and every 45 minutes otherwise. It prints one line per pass, and an ESPN failure in one league doesn't stop the others. The record page shows how long before the start forecasts were locked, per league.

It can run next to `npm run dev` or `npm run start`. Both write `.cache/ledger/`, and each write merges with the file on disk, so nothing is lost: per game, the latest forecast taken before the scheduled start wins.

As a long-running process, in its own terminal:

```bash
npm run refresh
```

As a Windows Task Scheduler task that starts at logon (output appends to `.cache\refresh.log`):

```bash
schtasks /Create /TN "ShadowCrypts refresh" /SC ONLOGON /RL LIMITED /F /TR "cmd /c cd /d C:\path\to\shadowcrypts-predictions && npm run refresh >> .cache\refresh.log 2>&1"
```

Change the path if the project lives somewhere else. If Windows says access is denied, run the command from a terminal opened as administrator. The task opens a console window at logon, and closing it stops the refresher. To start it right away or remove it:

```bash
schtasks /Run /TN "ShadowCrypts refresh"
```

```bash
schtasks /Delete /TN "ShadowCrypts refresh" /F
```

## Hosting it

To use the app on your phone anywhere, it needs to be online. "Add to home screen" and offline mode also require HTTPS on a real address.

The app writes data it must keep: ESPN caches and the forecast ledger behind the track record, both in `.cache/`. So host it somewhere with a persistent disk, and run the refresher alongside it.

### On this computer

```bash
npm run prod
```

That builds the site, then serves it on port 3000 of this computer only (127.0.0.1) with the refresher running alongside (`npm run serve` skips the build when nothing changed). Tailscale Serve and Cloudflare Tunnels reach it there; `HOST=0.0.0.0` opens it to your local networks. To start it at logon, open a terminal as administrator and run the following. It replaces the refresher-only task above, so delete that one if you made it.

```bash
schtasks /Create /TN "ShadowCrypts" /SC ONLOGON /RL LIMITED /F /TR "cmd /c cd /d C:\path\to\shadowcrypts-predictions && npm run serve >> .cache\serve.log 2>&1"
```

After changing the code, run `npm run build` again and restart it. To reach it from your phone while away from home, put it on a private network such as [Tailscale](https://tailscale.com) (install it on the PC and the phone, turn on HTTPS certificates in its admin console, then `tailscale serve 3000` gives an HTTPS address only your devices can open; set SITE_URL to it in `.env`), or publish it with a Cloudflare Tunnel. The site is only up while the PC is on.

### Security before going public

The app runs Next.js 16.4.6 with React 19.3, and `npm audit` reports no known vulnerabilities, including the remote-code-execution bug on Windows-hosted servers and the Server Components denial-of-service bugs that affected 14.x. It needs Node.js 20.9 or newer (the Docker image uses Node 24 and runs as the unprivileged `node` user). Team logos come resized from ESPN's image service (`lib/imageLoader.ts`), so Next's image optimizer, a past source of security advisories, stays switched off. The app uses no Server Actions, forms or rewrites, takes no accounts or personal data, and every image route renders on the Node.js runtime. Run `npm audit` again before each deploy; new advisories turn up.

What every response carries (`proxy.ts`, `lib/security.ts`, tested in `tests/security.test.ts`; [SECURITY.md](../SECURITY.md) has the full list, the deployment checklist and the latest audit):

- **Content Security Policy with a nonce per page**: scripts run only from this site or with that request's one-time nonce (Next.js puts it on its own scripts; the layout puts it on the theme script), so injected script can't run. Images come only from this site and ESPN's image service, fetches only go to this site, and plugins, `<base>` and framing are blocked. Over HTTPS, stray `http://` requests are upgraded. The offline page has its own locked-down policy.
- **Headers**: HSTS (a year, subdomains included, preload-ready), `nosniff`, `X-Frame-Options: DENY`, a strict referrer policy, a Permissions-Policy that turns off the camera, microphone, location, payment and the rest, `Cross-Origin-Opener-Policy: same-origin`, origin-keyed agent clusters, `X-Permitted-Cross-Domain-Policies: none`, and no `X-Powered-By`, on the app's responses and on everything the proxy answers itself. API responses are same-origin only.
- **One gate**: the proxy sees every request but build output and the site's fixed files (service worker, offline page, robots.txt, manifest), so an address with a dot in it (`/wp-login.php`, `/.env`) is checked like any other. Pages are GET and HEAD only (anything else gets `405` before the app runs).
- **Rate limits** per client per minute: 300 page loads (3,000 of the router's own fetches: link prefetches and in-app navigation, told apart by the browser's `Sec-Fetch-Dest`, since Next.js strips its router headers before the proxy), 120 API calls, and 40 calls to the costly endpoints: the ones that reach ESPN for games in progress (`/api/legs`, `/api/sweat`, `/api/cards`, `/api/calendar`), the alert and report endpoints, and share images drawn on request. Each costly endpoint also has a cap of 1,200 a minute for everyone together, so no amount of clients can turn the site into a flood at ESPN, and flooding one endpoint doesn't starve the others. Over the limit gets `429` with `Retry-After` and `RateLimit-*` headers. Behind a reverse proxy (Caddy, Cloudflare, a host's load balancer), set `TRUST_PROXY_HOPS=1` (one per proxy that appends to `X-Forwarded-For`) so limits key on the real client address, which a client then can't fake.
- **Input**: every id in a URL is checked against a strict pattern before it's used, lists are capped (`ids` to 200, shared parlays to 12 legs), and nothing a link says is shown as the site's own words or numbers. Request bodies are read only up to a small cap and cut off past it, streamed uploads included (`lib/http.ts`), and Next.js keeps at most 64 KB of any body (`proxyClientMaxBodySize`). Addresses that can't be pages (`lib/routes.ts`, kept in step with the app folder by a test) get a self-contained 404 page from the proxy before the app runs, which also turns away scanners probing for `/wp-admin` and the like.
- **Monitoring**: anything the Content Security Policy blocks is reported by browsers to `/api/csp-report` (size-capped) and logged; every server error (`instrumentation.ts`) and every rate-limit refusal is logged too, all as one JSON line each, without addresses, identifying headers or query strings.
- **Alert keys**: the VAPID key pair that signs background alerts is made on first use and kept in `.cache/push-vapid.json` (readable by its owner only, on Linux and macOS); set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to supply your own (changing them later means every browser has to turn alerts on again), and `VAPID_SUBJECT` (a `mailto:` or `https:` address) so push services can reach you about them. The alert endpoints take JSON only, from the site's own pages, size-capped and rate-limited; alerts go only to the browsers' own push services, and a new subscription is kept only once its push service has accepted the first alert. `.cache/` and every `.env` file stay out of git and the Docker image.
- **Network**: `npm run dev`, `npm run start` and `npm run serve` listen on 127.0.0.1, and Docker publishes on 127.0.0.1 unless `WEB_BIND` says otherwise. Going public, cap request bodies (64 KB is plenty) and request time in the reverse proxy: Next.js reads a request's whole body before the proxy sees it, so without that a slow upload can hold a connection open for up to five minutes (memory stays bounded either way).
- **security.txt**: set `SECURITY_CONTACT` (a `mailto:` or `https:` address) and `/.well-known/security.txt` tells researchers where to report a vulnerability (RFC 9116). Without it, nothing is published.

### Quality bar

Measured with `npm run audit` (Lighthouse 13.5) on a production build, ten main pages, phone and desktop:

- **Accessibility 100, best practices 100, SEO 100** on every page. Every text color clears WCAG AA contrast (4.5:1) on every background it's used on, in both themes (the tokens in `app/styles/globals.css`); touch targets are at least 24 px; motion stops under the reduced-motion setting.
- **Performance 100 on desktop**, 93–99 on Lighthouse's simulated slow phone (zero layout shift everywhere; the gap is its estimate of the scripts arriving over a slow 4G line, while pages actually paint about 130 ms after the first byte).
- **SEO**: titles, descriptions and share-preview tags always in `<head>`; structured data (schema.org JSON-LD) for the site, every game as a sports event, every team (with its regulars) and every player; real 404 statuses; game titles as people search them ("Nuggets vs Pelicans prediction, Oct 28"), and once a game is over, as a result ("Thunder 117, Cavaliers 112: result and forecast, Nov 2", with whether the forecast called it); a sitemap (built per request: leagues, teams, recently active players and every game still to play) and robots.txt.

### On a server

The included `Dockerfile` and `docker-compose.yml` run the site and the refresher with a shared `cache` volume, for hosts that build Docker images themselves (Railway, Render and Fly.io all can, with a persistent volume mounted at `/app/.cache`). The image has not been test-built yet: Docker Desktop wouldn't start on the development PC.

```bash
docker compose up -d --build
```

- **SITE_URL:** set it to your public address (e.g. `https://picks.example.com`) in the environment or a `.env` file, so shared links, share images and the calendar feed point there. This applies outside Docker too.
- **First load:** on an empty disk every page answers within about 20 seconds, but for the first few minutes forecasts can be well off: measured Nov 5, 2026 against a full host, the biggest gap was 8.8 points of win chance at first (NBA average 4.2), and 1.4 about three minutes in, once about half the closing lines and box scores were on file. The rest fills in behind them: all but a sliver of graded prop lines took about 27 minutes (22,890 of 23,063), most of the wait being NBA and NHL prop history. Until then a notice under the header says which stage it's at, and `/api/health` reports `history.share` and `history.forecastsSettled`. Run `npm run warm` (or `docker compose run --rm web npm run warm`) before opening a new host to the public, so nobody sees those first minutes.
- **Moving hosts:** most of `.cache/` downloads again, but forward-tested records can't, because they only exist by having been saved before each game. Copy these across or they start over from nothing: `ledger/`, `prop-ledger/`, `espn-ledger/`, `fantasy-ledger.json`, `movement/` and `odds-history/`. On Nov 5, 2026 a fresh host had none of the 1,620 logged prop picks. Back them up too: there's no other copy. `push-vapid.json` holds the private key for alerts, so copy it only over a private channel, and never into anything public.
- **Staying up:** `next start` has died on this Windows PC a handful of times with a native crash (exit code `0xC0000409`, no message), about 4 seconds after a start and once about 95 seconds in. Root cause not found: an 8-minute soak across five model rebuilds (384 pages, none failed, memory flat near 600 MB) didn't bring it back, and a real out-of-memory crash here looks different (exit code 134, with a message). So run it under something that restarts it. `npm run serve` does, logging the time, the exit code and how long it ran, and a fatal error inside Node leaves a report in `.cache/crash-reports/` (without the environment, so no keys). A crash with no report points at native code.

Put it behind HTTPS, either with a host that provides it (most do) or a reverse proxy such as Caddy. `/api/health` reports whether the server is up and its data folder is writable.

Serverless hosts with a read-only or temporary filesystem (Vercel, for example) will serve pages, but they lose the ledger and caches between runs. The track record and locked forecasts wouldn't build up there.
