import { ImageResponse } from 'next/og';
import { BRAND, brandMarkDataUri } from '../../../../lib/brand';
import { pct, pctCapped } from '../../../../lib/format';
import { formatAmerican } from '../../../../lib/model/market';
import { sharedLegs } from '../../../../lib/model/sharedParlay';
import { readShareCode, summarize } from '../../../../lib/parlay';

export const alt = 'A shared parlay and its chance to cash';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SHOWN = 6;

/** Link preview for a shared parlay: the chance it cashes, fair odds and its legs, all priced fresh. */
export default async function SharedParlayImage({ params }: { params: Promise<{ code: string }> }) {
  const { ids, price } = readShareCode((await params).code);
  const { legs } = ids.length ? await sharedLegs(ids).catch(() => ({ legs: [] })) : { legs: [] };
  const summary = summarize(legs, price);
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
          <span style={{ marginLeft: 'auto', fontSize: 26, color: '#a59fbe' }}>Shared parlay</span>
        </div>
        {summary ? (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 56 }}>
            <div style={{ display: 'flex', flexDirection: 'column', width: 380 }}>
              <span style={{ fontSize: 148, fontWeight: 800, lineHeight: 1, color: '#b9a4ff' }}>{pctCapped(summary.chance)}</span>
              <span style={{ fontSize: 40, fontWeight: 700, marginTop: 8 }}>to cash</span>
              <span style={{ fontSize: 28, color: '#bab5ce', marginTop: 18 }}>
                {legs.length} legs · fair odds {formatAmerican(summary.fair)}
                {price !== null ? ` · offered ${formatAmerican(price)}` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 14 }}>
              {legs.slice(0, SHOWN).map((l) => (
                <div
                  key={l.key}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderRadius: 16, background: 'rgba(46, 42, 70, 0.75)', fontSize: 26 }}
                >
                  <span style={{ display: 'flex', maxWidth: 520, overflow: 'hidden' }}>{l.label.length > 38 ? `${l.label.slice(0, 37)}…` : l.label}</span>
                  <span style={{ color: '#22d3ee', fontWeight: 700 }}>{pct(l.prob)}</span>
                </div>
              ))}
              {legs.length > SHOWN && <span style={{ fontSize: 24, color: '#a59fbe' }}>+ {legs.length - SHOWN} more</span>}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: 56, fontWeight: 700 }}>What your parlay is really worth.</div>
        )}
        <div style={{ display: 'flex', fontSize: 22, color: '#7f7896' }}>Chances are the books&apos; numbers with their margin removed, combined. For fun, not betting advice.</div>
      </div>
    ),
    size
  );
}
