/**
 * Team logos come resized from ESPN's own image service instead of Next's
 * image optimizer, so the server never fetches or decodes images itself (the
 * optimizer has had remote-code-execution and denial-of-service bugs) and a
 * 32-pixel logo is about 3 KB instead of the 500-pixel original's 50 KB.
 */
export default function espnImageLoader({ src, width }: { src: string; width: number; quality?: number }) {
  try {
    const url = new URL(src);
    if (url.hostname === 'a.espncdn.com' && url.pathname.startsWith('/i/')) {
      return `https://a.espncdn.com/combiner/i?img=${url.pathname}&w=${width}&h=${width}`;
    }
  } catch {
    // A relative or odd src is served as is.
  }
  return src;
}
