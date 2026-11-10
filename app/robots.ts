import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const url = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return {
    // The JSON endpoints are for programs, not search results.
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${url}/sitemap.xml`
  };
}
