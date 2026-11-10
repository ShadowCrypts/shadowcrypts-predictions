import { ImageResponse } from 'next/og';
import { BRAND, brandMarkDataUri } from '../../../../lib/brand';
import { pct } from '../../../../lib/format';
import { isLeagueId, LEAGUES } from '../../../../lib/leagues';
import { getLeagueModel } from '../../../../lib/model';
import { nextPropRow, playerLog } from '../../../../lib/model/playerLog';
import { propEngine } from '../../../../lib/model/propEngines';
import { marketLabel } from '../../../../lib/props';
import { headshotUrl } from '../../../../lib/search';

export const alt = 'Player props';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** ESPN's headshot as a data URI, or null when there isn't one (an image the renderer can't load would sink the whole preview). */
async function headshot(league: string, id: string) {
  try {
    const url = new URL(headshotUrl(league, id));
    const response = await fetch(`https://a.espncdn.com/combiner/i?img=${url.pathname}&w=320&h=320&scale=crop`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok || !/^image\/(png|jpeg)$/.test(response.headers.get('content-type') ?? '')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length < 2_000_000 ? `data:${response.headers.get('content-type')};base64,${bytes.toString('base64')}` : null;
  } catch {
    return null;
  }
}

/** What the preview shows: who he is and, when he has a game on the board, its time and his main lines. Null falls back to the site card. */
async function load(leagueId: string, playerId: string) {
  if (!isLeagueId(leagueId) || !/^\d{1,15}$/.test(playerId)) return null;
  const league = LEAGUES[leagueId];
  const engine = propEngine(league);
  if (!engine) return null;
  try {
    const model = await getLeagueModel(league.id);
    const log = await playerLog(league, model, playerId, 1);
    if (!log) return null;
    const next = nextPropRow(model, playerId);
    const team = model.teams[next?.row.teamId ?? log.teamId];
    const lines = next
      ? engine.markets
          .map((m) => ({ market: m, cell: next.row.cells[m] }))
          .filter((x) => x.cell?.line)
          .slice(0, 3)
          .map(({ market, cell }) => ({ label: marketLabel(market).short, line: cell!.line!.line, over: cell!.line!.forecastOver, projection: cell!.projection }))
      : [];
    return { league, log, team, next, lines, photo: await headshot(league.id, playerId) };
  } catch {
    return null;
  }
}

/** Link preview for a player page: his photo and team, and his next game's main lines with the chance of each over. */
export default async function PlayerImage({ params }: { params: Promise<{ league: string; playerId: string }> }) {
  const { league, playerId } = await params;
  const data = await load(league, playerId);

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
          {data && <span style={{ marginLeft: 'auto', fontSize: 26, color: '#a59fbe' }}>{data.league.name} player props</span>}
        </div>

        {data ? (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 56 }}>
            <div style={{ display: 'flex', position: 'relative', width: 260, height: 260 }}>
              <div style={{ display: 'flex', width: 260, height: 260, borderRadius: 130, overflow: 'hidden', background: '#1b1830', border: '4px solid #3b2f6e', alignItems: 'center', justifyContent: 'center' }}>
                {data.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.photo} width={252} height={252} alt="" style={{ objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 96, fontWeight: 700, color: '#7f7896' }}>{data.log.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>
                )}
              </div>
              {data.team?.logo && (
                <div style={{ display: 'flex', position: 'absolute', right: -6, bottom: -6, width: 96, height: 96, borderRadius: 48, background: '#110f1c', border: '3px solid #29253e', alignItems: 'center', justifyContent: 'center' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.team.logo} width={72} height={72} alt="" />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: 26, color: '#baa4ff', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>{data.team?.name ?? data.league.name}</span>
              <span style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, marginTop: 6 }}>{data.log.name}</span>
              {data.next && (
                <span style={{ fontSize: 28, color: '#bab5ce', marginTop: 14 }}>
                  Next: {data.next.game.away.abbr} @ {data.next.game.home.abbr} · {timeFormat.format(new Date(data.next.game.date))} ET
                </span>
              )}
              {data.lines.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', marginTop: 22, gap: 10 }}>
                  {data.lines.map((l) => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'baseline', gap: 16, fontSize: 32 }}>
                      <span style={{ color: '#bab5ce', width: 300 }}>{l.label}</span>
                      <span style={{ fontWeight: 700, width: 110 }}>{l.line}</span>
                      <span style={{ fontWeight: 700, color: l.over >= 0.5 ? '#b9a4ff' : '#7f7896' }}>{pct(l.over)} over</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: 30, color: '#bab5ce', marginTop: 22 }}>Projections, prop lines and every recent game against the line.</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: 56, fontWeight: 700 }}>Every player prop, with the real chance of the over.</div>
        )}

        <div style={{ display: 'flex', fontSize: 22, color: '#7f7896' }}>Chances follow the book&apos;s price with its margin removed. For insight and fun, not betting advice.</div>
      </div>
    ),
    size
  );
}
