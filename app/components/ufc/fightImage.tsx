import { ImageResponse } from 'next/og';
import { BRAND, brandMarkDataUri } from '../../../lib/brand';
import { pct } from '../../../lib/format';
import { formatAmerican } from '../../../lib/model/market';
import { initials } from '../../../lib/search';
import { boutEnding, type UfcBout, type UfcEvent, type UfcFighter } from '../../../lib/ufc/feed';
import { calledIt, cardSpot, shownChance, weightName, type UfcModel } from '../../../lib/ufc/model';

export const SIZE = { width: 1200, height: 630 };
const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A fighter's ESPN headshot as a data URI (drawn into the image), or null when ESPN has none or is slow. */
async function headshot(id: string) {
  try {
    const res = await fetch(`https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/${id}.png&w=360&h=262`, { signal: AbortSignal.timeout(4_000), cache: 'no-store' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 2_000 && bytes.length < 600_000 ? `data:${type};base64,${bytes.toString('base64')}` : null;
  } catch {
    return null;
  }
}

function Fighter({ fighter, photo, chance, favorite, done }: { fighter: UfcFighter; photo: string | null; chance: number; favorite: boolean; done: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 420 }}>
      <div style={{ display: 'flex', width: 200, height: 200, borderRadius: 100, overflow: 'hidden', background: '#2e2a46', alignItems: 'center', justifyContent: 'center', border: `4px solid ${favorite ? '#8b5cf6' : '#2e2a46'}` }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} width={276} height={200} style={{ objectFit: 'cover' }} alt="" />
        ) : (
          <span style={{ fontSize: 72, fontWeight: 700, color: '#bab5ce' }}>{initials(fighter.name)}</span>
        )}
      </div>
      <span style={{ marginTop: 18, fontSize: 38, fontWeight: 700, color: '#f5f3fc', textAlign: 'center' }}>{fighter.name}</span>
      {done ? (
        fighter.winner === true && <span style={{ marginTop: 6, fontSize: 40, fontWeight: 700, color: '#4ade80' }}>Won</span>
      ) : (
        <span style={{ marginTop: 6, fontSize: 64, fontWeight: 700, color: favorite ? '#b9a4ff' : '#7f7896' }}>{pct(chance)}</span>
      )}
    </div>
  );
}

/** The link preview for a fight (or an event, by its main event): both fighters, their chances, and when, or how it ended. */
export async function fightImage(model: UfcModel | null, bout: UfcBout | undefined, event: UfcEvent | undefined, heading?: string) {
  const ready = model && bout && event;
  const { chanceA } = ready ? shownChance(model, bout.id) : { chanceA: 0.5 };
  const [photoA, photoB] = ready ? await Promise.all([headshot(bout.a.id), headshot(bout.b.id)]) : [null, null];
  const odds = ready ? model.forecasts.get(bout.id)?.odds : null;
  const done = !!ready && bout.completed;
  const correct = ready ? calledIt(bout, chanceA) : null;
  const details = ready ? [cardSpot(bout, event), weightName(bout.weightClass), `${bout.rounds} rounds`].filter(Boolean).join(' · ') : '';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '44px 60px', background: 'radial-gradient(circle at 50% 0%, #2b1764 0%, #0d0a1c 55%, #08070e 100%)', color: '#f5f3fc', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandMarkDataUri(52)} width={52} height={52} alt="" />
          <span style={{ fontSize: 26, fontWeight: 700 }}>{BRAND.name}</span>
          <span style={{ marginLeft: 'auto', fontSize: 26, color: '#a59fbe' }}>{heading ?? event?.shortName ?? 'UFC'}</span>
        </div>
        {ready ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Fighter fighter={bout.a} photo={photoA} chance={chanceA} favorite={chanceA >= 0.5} done={done} />
              <span style={{ fontSize: 40, fontWeight: 700, color: '#7f7896' }}>vs</span>
              <Fighter fighter={bout.b} photo={photoB} chance={1 - chanceA} favorite={chanceA < 0.5} done={done} />
            </div>
            {!done && (
              <div style={{ display: 'flex', marginTop: 26, height: 14, borderRadius: 7, overflow: 'hidden', background: '#2e2a46' }}>
                <div style={{ width: `${chanceA * 100}%`, background: chanceA >= 0.5 ? '#8b5cf6' : '#2e2a46' }} />
                <div style={{ flex: 1, background: chanceA < 0.5 ? '#8b5cf6' : '#2e2a46' }} />
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', fontSize: 54, fontWeight: 700 }}>Every UFC fight, with win chances and a public record.</div>
        )}
        {ready && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 25, color: '#bab5ce' }}>
            <span>{done ? `${boutEnding(bout) ?? 'Final'}${correct === null ? '' : ` · forecast ${correct ? 'called it' : 'missed'}`}` : `${details} · ${when.format(new Date(event.date))} ET`}</span>
            {!done && odds && <span>Line {formatAmerican(odds.aMoneyline)} / {formatAmerican(odds.bMoneyline)}</span>}
          </div>
        )}
      </div>
    ),
    { ...SIZE, headers: { 'cache-control': 'public, max-age=600' } }
  );
}
