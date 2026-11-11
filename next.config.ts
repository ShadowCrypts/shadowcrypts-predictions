import type { NextConfig } from 'next';
import { OFFLINE_POLICY, SECURITY_HEADERS } from './lib/security';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No "X-Powered-By: Next.js" advertising the stack.
  poweredByHeader: false,
  // Titles, descriptions and share-preview tags always in <head>, for every crawler and link-preview bot
  // (streamed metadata lands in <body>, which some of them never read).
  htmlLimitedBots: /.*/,
  experimental: {
    // With a proxy, Next.js keeps a copy of each request body in memory (10 MB by default). The largest body the
    // site takes is a 32 KB alert list, so a copy is never allowed past 64 KB, whatever someone sends.
    proxyClientMaxBodySize: '64kb'
  },
  // Not experimental.inlineCss: Next.js 16.4 leaves the inlined <style> without the page's nonce (the strict
  // policy would block it) and copies the stylesheet into every page's HTML twice over.
  images: {
    // Logos are resized by ESPN's image service (lib/imageLoader.ts), which keeps
    // Next's own image optimizer, and its security bugs, switched off.
    loader: 'custom',
    loaderFile: './lib/imageLoader.ts'
  },
  async headers() {
    return [
      // Pages get their Content Security Policy from proxy.ts, with a nonce per request.
      { source: '/:path*', headers: SECURITY_HEADERS },
      { source: '/offline.html', headers: [{ key: 'Content-Security-Policy', value: OFFLINE_POLICY }] },
      // The service worker is re-checked on every visit so a fix reaches everyone.
      // Spelled out rather than plain "no-cache": Cloudflare replaces a bare no-cache with its own 4-hour default.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      // It's on every page's footer and rarely changes; a day keeps repeat visits from fetching it again.
      { source: '/signature-:size(360|720).webp', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
      { source: '/backdrop-:shape(wide|tall)-:theme(dark|light).webp', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] }
    ];
  }
};

export default nextConfig;
