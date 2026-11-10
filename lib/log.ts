// One JSON object per line on stdout/stderr, so logs can be searched and
// counted by any tool (or read by eye). Paths are logged without their query
// strings and requests without addresses or identifying headers (at most the
// browser's Sec-Fetch labels): nothing that could identify a visitor.

type Level = 'info' | 'warn' | 'error';

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** A URL or path cut to its path: no query string, no fragment, no credentials. */
export function pathOnly(url: string | null | undefined) {
  if (!url) return null;
  try {
    const u = new URL(url, 'http://local');
    return u.origin === 'http://local' ? u.pathname : `${u.origin}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0].slice(0, 200);
  }
}
