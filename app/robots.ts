import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const url = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return {
    // The JSON endpoints are for programs, not search results. The feedback form is linked from every page with
    // that page in its address, so crawlers took each as a new page (17,498 loads on the UFC card's weekend).
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/feedback'] },
    sitemap: `${url}/sitemap.xml`
  };
}
