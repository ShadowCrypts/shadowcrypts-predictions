/** The site's public address (SITE_URL in production), without a trailing slash, for absolute links. */
export function siteUrl() {
  return (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}
