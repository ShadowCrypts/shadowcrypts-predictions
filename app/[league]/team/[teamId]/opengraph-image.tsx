import { ImageResponse } from 'next/og';
import { BRAND, brandMarkDataUri } from '../../../../lib/brand';
import { pct } from '../../../../lib/format';
import { isLeagueId, LEAGUES } from '../../../../lib/leagues';
import { getLeagueModel } from '../../../../lib/model';

export const alt = 'Team forecasts';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** What the preview shows: the team, its record and Elo rank, and its next game's forecast. Null falls back to the site card. */
async function load(leagueId: string, teamId: string) {
  if (!isLeagueId(leagueId) || !/^\d{1,10}$/.test(teamId)) return null;
  try {
    const model = await getLeagueModel(leagueId);
    const team = model.teams[teamId];
    if (!team) return null;
    const ranking = model.rankings.find((r) => r.team.id === teamId);
    const next = (model.teamGames[teamId] ?? [])
      .map((id) => model.predictions[id])
      .filter((p) => p && p.game.state === 'pre')
      .sort((a, b) => a.game.date.localeCompare(b.game.date))[0];
    return { league: LEAGUES[leagueId], team, ranking, of: model.rankings.length, next };
  } catch {
    return null;
  }
}

/** Link preview for a team page. */
export default async function TeamImage({ params }: { params: Promise<{ league: string; teamId: string }> }) {
  const { league, teamId } = await params;
  const data = await load(league, teamId);
  const accent = data?.team.color ?? '#2b1764';
  const nextChance = data?.next ? (data.next.game.home.teamId === teamId ? data.next.homeProb : 1 - data.next.homeProb) : null;
  const opponent = data?.next ? (data.next.game.home.teamId === teamId ? `vs ${data.next.game.away.abbr}` : `@ ${data.next.game.home.abbr}`) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '48px 64px',
          background: `radial-gradient(circle at 15% 10%, ${accent}66 0%, #0d0a1c 55%, #08070e 100%)`,
          color: '#f5f3fc',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandMarkDataUri(56)} width={56} height={56} alt="" />
          <span style={{ fontSize: 28, fontWeight: 700 }}>{BRAND.name}</span>
          {data && <span style={{ marginLeft: 'auto', fontSize: 26, color: '#a59fbe' }}>{data.league.name}</span>}
        </div>

        {data ? (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 56 }}>
            {data.team.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.team.logo} width={240} height={240} alt="" />
            ) : (
              <div style={{ display: 'flex', width: 240, height: 240 }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>{data.team.name}</span>
              <span style={{ fontSize: 32, color: '#bab5ce', marginTop: 14 }}>
                {[data.ranking?.record, data.ranking ? `#${data.ranking.rank} of ${data.of} by Elo` : null].filter(Boolean).join(' · ')}
              </span>
              {data.next && nextChance !== null && (
                <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28 }}>
                  <span style={{ fontSize: 28, color: '#a59fbe' }}>
                    Next: {opponent} · {timeFormat.format(new Date(data.next.game.date))} ET
                  </span>
                  <span style={{ fontSize: 56, fontWeight: 700, color: nextChance >= 0.5 ? '#b9a4ff' : '#7f7896', marginTop: 4 }}>{pct(nextChance)} to win</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: 56, fontWeight: 700 }}>Every game, forecast and graded in public.</div>
        )}

        <div style={{ display: 'flex', fontSize: 22, color: '#7f7896' }}>Forecasts for insight and fun, not betting advice.</div>
      </div>
    ),
    size
  );
}
