import { siteUrl } from '../../../lib/site';

export const dynamic = 'force-dynamic';

/**
 * /.well-known/security.txt (RFC 9116): where to report a vulnerability. Only
 * served when SECURITY_CONTACT is set (a mailto: or https: address), so no
 * address is ever published without the site's owner choosing it.
 */
export function GET() {
  const contact = process.env.SECURITY_CONTACT?.trim();
  if (!contact || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(contact)) return new Response('Not found', { status: 404 });
  // Valid for six months from whenever it's read, as the RFC asks for an expiry.
  const expires = new Date(Date.now() + 182 * 86_400_000).toISOString();
  const body = [`Contact: ${contact}`, `Expires: ${expires}`, 'Preferred-Languages: en', `Canonical: ${siteUrl()}/.well-known/security.txt`, ''].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
}
