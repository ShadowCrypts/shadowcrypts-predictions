import { ImageResponse } from 'next/og';
import { BRAND, brandMarkDataUri } from '../../../../lib/brand';
import { pctCapped } from '../../../../lib/format';
import { isLeagueId } from '../../../../lib/leagues';
import { getLeagueModel } from '../../../../lib/model';
import { CardData, toCard } from '../../../../lib/model/card';

export const alt = 'Game forecast';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const pct = pctCapped;
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The game's card straight from the model; a preview without it falls back to the site card. */
async function loadCard(league: string, gameId: string): Promise<CardData | null> {
  if (!isLeagueId(league)) return null;
  try {
    const prediction = (await getLeagueModel(league)).predictions[gameId];
    return prediction ? toCard(prediction) : null;
  } catch {
    return null;
  }
}

function Team({ logo, name, prob, picked }: { logo: string | null; name: string; prob: number | null; picked: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 360 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} width={150} height={150} alt="" /> : <div style={{ width: 150, height: 150 }} />}
      <span style={{ marginTop: 18, fontSize: 40, fontWeight: 700, color: '#f5f3fc' }}>{name}</span>
      {prob !== null && <span style={{ marginTop: 6, fontSize: 64, fontWeight: 700, color: picked ? '#b9a4ff' : '#7f7896' }}>{pct(prob)}</span>}
    </div>
  );
}

/** Link preview for a game: both teams, the forecast and when it's on (or the final score). */
export default async function GameImage({ params }: { params: Promise<{ league: string; gameId: string }> }) {
  const { league, gameId } = await params;
  const card = await loadCard(league, gameId);
  const final = card?.completed && card.home.score !== null && card.away.score !== null;
  const homeProb = card ? (card.state === 'in' && card.liveHomeProb !== null ? card.liveHomeProb : card.homeProb) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '48px 64px',
          background: 'radial-gradient(circle at 50% 0%, #2b1764 0%, #0d0a1c 55%, #08070e 100%)',
          color: '#f5f3fc',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandMarkDataUri(56)} width={56} height={56} alt="" />
          <span style={{ fontSize: 28, fontWeight: 700 }}>{BRAND.name}</span>
          {card && <span style={{ marginLeft: 'auto', fontSize: 26, color: '#a59fbe' }}>{card.league.toUpperCase()}</span>}
        </div>

        {card && homeProb !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Team logo={card.away.logo} name={card.away.shortName} prob={final ? null : 1 - homeProb} picked={homeProb < 0.5} />
              <span style={{ fontSize: final ? 88 : 40, fontWeight: 700, color: final ? '#f5f3fc' : '#7f7896' }}>
                {final ? `${card.away.score}–${card.home.score}` : 'at'}
              </span>
              <Team logo={card.home.logo} name={card.home.shortName} prob={final ? null : homeProb} picked={homeProb >= 0.5} />
            </div>
            {!final && (
              <div style={{ display: 'flex', marginTop: 28, height: 16, borderRadius: 8, overflow: 'hidden', background: '#2e2a46' }}>
                <div style={{ width: `${(1 - homeProb) * 100}%`, background: homeProb < 0.5 ? '#8b5cf6' : '#2e2a46' }} />
                <div style={{ flex: 1, background: homeProb >= 0.5 ? '#8b5cf6' : '#2e2a46' }} />
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: 56, fontWeight: 700 }}>Every game, forecast and graded in public.</div>
        )}

        {card && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, color: '#bab5ce' }}>
            <span>
              {final
                ? `Final · forecast ${card.correct ? 'called it' : 'missed'}: ${(card.pick === 'home' ? card.home : card.away).abbr} ${pct(card.pickProb)}`
                : card.state === 'in'
                  ? `Live win probability · ${card.statusDetail}`
                  : `${timeFormat.format(new Date(card.date))} ET`}
            </span>
            {!final && card.line && <span>{card.state === 'in' ? 'Pregame line' : 'Line'} {card.line}</span>}
          </div>
        )}
      </div>
    ),
    size
  );
}
