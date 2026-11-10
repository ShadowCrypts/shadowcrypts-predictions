import { ImageResponse } from 'next/og';
import { BRAND, brandMarkDataUri } from '../../../../lib/brand';
import { readPicksShare } from '../../../../lib/picksShare';

export const alt = 'A pick’em record against the model';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Link preview for a shared pick'em record: theirs and the model's, side by side. */
export default async function SharedPicksImage({ params }: { params: Promise<{ code: string }> }) {
  const score = readPicksShare((await params).code);
  const games = score ? score.yours.won + score.yours.lost : 0;
  const side = (name: string, r: { won: number; lost: number }, color: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 400 }}>
      <span style={{ fontSize: 34, color: '#bab5ce' }}>{name}</span>
      <span style={{ fontSize: 132, fontWeight: 800, lineHeight: 1.05, color }}>{`${r.won}–${r.lost}`}</span>
      <span style={{ fontSize: 30, color: '#a59fbe' }}>{`${Math.round((r.won / Math.max(1, games)) * 100)}% correct`}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '48px 64px',
          background: 'radial-gradient(circle at 20% 0%, #2b1764 0%, #0d0a1c 55%, #08070e 100%)',
          color: '#f5f3fc',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandMarkDataUri(56)} width={56} height={56} alt="" />
          <span style={{ fontSize: 28, fontWeight: 700 }}>{BRAND.name}</span>
          <span style={{ marginLeft: 'auto', fontSize: 26, color: '#a59fbe' }}>Pick&apos;em</span>
        </div>
        {score ? (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', gap: 48 }}>
            {side('Them', score.yours, '#b9a4ff')}
            <span style={{ fontSize: 40, fontWeight: 700, color: '#7f7896' }}>vs</span>
            {side('The model', score.model, '#22d3ee')}
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: 56, fontWeight: 700 }}>Can you beat the model?</div>
        )}
        <div style={{ display: 'flex', fontSize: 24, color: '#7f7896' }}>
          {score ? `Winners picked on the same ${games} games, as counted in their browser. Can you beat it?` : 'Pick winners, see your record next to the model’s.'}
        </div>
      </div>
    ),
    size
  );
}
