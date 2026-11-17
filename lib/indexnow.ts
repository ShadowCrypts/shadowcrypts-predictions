// IndexNow: telling Bing (and through it DuckDuckGo, Yahoo and ChatGPT's search), Yandex, Seznam, Naver and Yep
// about new and changed pages the moment they exist, instead of waiting for their crawlers to come round. Free,
// no account: the search engines check the key published at KEY_PATH on this site. The refresher submits.
import { readStore, writeStore } from './cache';

/** Not a secret: it's published at KEY_PATH so the search engines can check a submission came from this site. Forks set INDEXNOW_KEY. */
export const indexNowKey = () => (/^[a-zA-Z0-9-]{8,128}$/.test(process.env.INDEXNOW_KEY ?? '') ? process.env.INDEXNOW_KEY! : '4a61be9e931e5d2ceabe10b760e69b1e');
export const KEY_PATH = '/.well-known/indexnow.txt';

const STORE = 'indexnow-submitted';
/** A page is sent again after this long, so pages that keep changing (a game's forecast) are looked at again. */
const RESEND_MS = 7 * 86_400_000;
/** Most addresses one submission carries (IndexNow allows 10,000). */
const BATCH = 2_000;

/** Which addresses are due: never sent, or sent long enough ago. Pure, for tests. */
export function dueForIndexNow(urls: string[], sent: Record<string, number>, now: number, limit = BATCH) {
  return [...new Set(urls)].filter((u) => !(u in sent) || now - sent[u] >= RESEND_MS).slice(0, limit);
}

/**
 * Sends the site's addresses that are due. Only from a real public HTTPS address (never from a laptop or a
 * test copy), and never more than one batch a call. Returns what happened, for the refresher's log.
 */
export async function submitIndexNow(urls: string[], siteUrl = process.env.SITE_URL ?? '', now = Date.now()) {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return 'IndexNow: no SITE_URL';
  }
  if (site.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(site.hostname) || process.env.INDEXNOW === 'off') return 'IndexNow: off here';
  const sent = (await readStore<Record<string, number>>(STORE)) ?? {};
  const ours = urls.filter((u) => {
    try {
      return new URL(u).host === site.host;
    } catch {
      return false;
    }
  });
  const due = dueForIndexNow(ours, sent, now);
  if (!due.length) return 'IndexNow: nothing new';
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: site.host, key: indexNowKey(), keyLocation: `${site.origin}${KEY_PATH}`, urlList: due }),
    signal: AbortSignal.timeout(30_000)
  });
  // 200 and 202 are both "received"; anything else is retried next time (nothing is marked sent).
  if (res.status !== 200 && res.status !== 202) return `IndexNow: refused (${res.status})`;
  for (const u of due) sent[u] = now;
  // Forget what's long past, so the record doesn't grow without end.
  for (const [u, t] of Object.entries(sent)) if (now - t > 4 * RESEND_MS) delete sent[u];
  await writeStore(STORE, sent);
  return `IndexNow: ${due.length} sent`;
}
