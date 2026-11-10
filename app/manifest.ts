import type { MetadataRoute } from 'next';
import { BRAND, brandMarkVersion } from '../lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  const v = brandMarkVersion();
  return {
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    categories: ['sports'],
    // Long-press the home-screen icon to jump straight to these.
    shortcuts: [
      { name: "Today's board", short_name: 'Today', url: '/' },
      { name: 'Live mode', short_name: 'Live', url: '/live' },
      { name: 'Player props', short_name: 'Props', url: '/props' },
      { name: 'Your parlay', short_name: 'Parlay', url: '/parlay' }
    ],
    background_color: BRAND.themeColor,
    theme_color: BRAND.themeColor,
    icons: [
      { src: `/icon?v=${v}`, sizes: 'any', type: 'image/svg+xml' },
      { src: `/brand-icon/192?v=${v}`, sizes: '192x192', type: 'image/png' },
      { src: `/brand-icon/512?v=${v}`, sizes: '512x512', type: 'image/png' },
      { src: `/brand-icon/512?maskable=1&v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
