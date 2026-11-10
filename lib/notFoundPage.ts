import { BRAND } from './brand';

/**
 * The page for addresses the site can't have, sent by the proxy itself with a
 * 404: self-contained (its one stylesheet carries the request's nonce), in
 * the site's colors for dark and light, and with nothing from the request in
 * it, so there's nothing to inject into. Answering here means a scanner's
 * thousand guesses never reach the app.
 */
export function notFoundPage(nonce: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="description" content="That page doesn't exist on ${BRAND.name}. Every game, forecast and graded pick is a click away on today's board.">
<meta name="theme-color" content="#08070e">
<title>Page not found · ${BRAND.shortName}</title>
<link rel="icon" href="/icon">
<style nonce="${nonce}">
:root { color-scheme: dark; --bg: #08070e; --card: #110f1c; --line: #29253e; --ink: #f5f3fc; --ink-2: #bab5ce; --accent: #7c3aed; --eyebrow: #baa4ff; }
@media (prefers-color-scheme: light) { :root { color-scheme: light; --bg: #f6f5fb; --card: #ffffff; --line: #e3e0ee; --ink: #13101f; --ink-2: #48435f; --eyebrow: #6826d6; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 440px; width: 100%; text-align: center; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 32px; }
img { display: block; margin: 0 auto; width: 100%; max-width: 288px; height: auto; border-radius: 12px; border: 1px solid var(--line); }
p.eyebrow { margin: 16px 0 0; font-size: 12px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--eyebrow); }
h1 { margin: 8px 0 0; font-size: 22px; }
p { color: var(--ink-2); font-size: 14px; }
a { display: inline-block; margin-top: 16px; padding: 10px 16px; border-radius: 12px; background: var(--accent); color: #fff; font-weight: 600; font-size: 14px; text-decoration: none; }
a:focus-visible { outline: 2px solid var(--eyebrow); outline-offset: 2px; }
nav { margin-top: 16px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
nav a { margin: 0; padding: 6px 12px; border-radius: 999px; background: transparent; border: 1px solid var(--line); color: var(--ink-2); font-weight: 500; font-size: 13px; }
</style>
</head>
<body>
<main>
<img src="/signature-720.webp" width="720" height="619" alt="ShadowCrypt signature: a hooded figure with glowing eyes, drawn in purple text characters">
<p class="eyebrow">404</p>
<h1>Nothing in this crypt</h1>
<p>That page doesn't exist, or the game or team is outside the seasons the model tracks.</p>
<a href="/">Back to today's board</a>
<nav aria-label="Elsewhere"><a href="/live">Live now</a><a href="/props">Player props</a><a href="/results">Last night's results</a><a href="/record">Track record</a></nav>
</main>
</body>
</html>`;
}
