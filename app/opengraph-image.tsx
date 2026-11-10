import { ImageResponse } from 'next/og';
import { BRAND, brandMarkDataUri } from '../lib/brand';

export const alt = BRAND.name;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Link-preview card for shared pages. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: 'radial-gradient(circle at 15% 0%, #3b1d8f 0%, #0d0a1c 55%, #08070e 100%)',
          color: '#f5f3fc',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandMarkDataUri(96)} width={96} height={96} alt="" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 52, fontWeight: 700, letterSpacing: -1 }}>ShadowCrypts</span>
            <span style={{ fontSize: 22, letterSpacing: 8, color: '#a59fbe' }}>PREDICTIONS</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.1, maxWidth: 960 }}>Every NFL, NBA, MLB and NHL game, forecast and graded in public.</span>
          <span style={{ fontSize: 28, color: '#bab5ce' }}>Win probabilities · power rankings · open track record</span>
        </div>
      </div>
    ),
    size
  );
}
