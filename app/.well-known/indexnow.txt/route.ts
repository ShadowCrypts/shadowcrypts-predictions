import { indexNowKey } from '../../../lib/indexnow';

/** /.well-known/indexnow.txt: the IndexNow key, which the search engines read to check a submission came from this site. */
export function GET() {
  return new Response(indexNowKey(), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
}
