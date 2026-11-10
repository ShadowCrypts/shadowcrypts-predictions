import { pct } from '../../lib/format';
import type { LeagueConfig } from '../../lib/leagues';
import type { TrackRecord } from '../../lib/model';
import { CalibrationChart } from './CalibrationChart';
import { ChanceBar } from './ChanceBar';

function Meter({ value }: { value: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-track" aria-hidden>
      <span className="block h-full rounded-full bg-gradient-to-r from-accent to-accent-strong" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

export function RecordTiles({ record }: { record: TrackRecord }) {
  const { overall, modelOnly, marketOnly, preLine } = record;
  const tiles = [
    {
      label: 'Forecast correct',
      value: pct(overall.accuracy, 1),
      chance: overall.accuracy,
      sub: `${overall.correct.toLocaleString()} of ${overall.games.toLocaleString()} · Brier ${overall.brier.toFixed(3)}`,
      highlight: true
    },
    {
      label: 'Before the line',
      value: pct(preLine.accuracy, 1),
      chance: preLine.accuracy,
      sub: `Every game as if no line were posted · Brier ${preLine.brier.toFixed(3)}`
    },
    { label: 'Elo ratings alone', value: pct(modelOnly.accuracy, 1), chance: modelOnly.accuracy, sub: `Brier ${modelOnly.brier.toFixed(3)} · same games` },
    {
      label: 'Betting market alone',
      value: marketOnly.games ? pct(marketOnly.accuracy, 1) : '—',
      chance: marketOnly.games ? marketOnly.accuracy : null,
      sub: marketOnly.games ? `Closing line on file for ${pct(record.marketCoverage)} of games` : 'Closing lines still downloading'
    },
    { label: 'Always picking home', value: pct(overall.homeBaseline, 1), chance: overall.homeBaseline, sub: 'The no-skill baseline' }
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className={`relative overflow-hidden rounded-xl p-3 ring-1 ${t.highlight ? 'bg-accent/10 ring-accent/40' : 'bg-raised ring-line'}`}>
          {t.highlight && <span className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-accent/25 blur-2xl" aria-hidden />}
          <p className="relative text-xs text-ink-2">{t.label}</p>
          <p className="relative mt-1 font-display text-2xl font-bold text-ink tabular">{t.value}</p>
          {t.chance !== null && (
            <span className="relative block">
              <ChanceBar chance={t.chance} width="w-full" />
            </span>
          )}
          <p className="relative mt-1.5 text-xs text-ink-3">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

export function BandTable({ record }: { record: TrackRecord }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-ink-3">
          <th className="pb-2 font-medium">Confidence</th>
          <th className="pb-2 text-right font-medium">Games</th>
          <th className="w-2/5 pb-2 pl-4 font-medium">Won</th>
        </tr>
      </thead>
      <tbody className="tabular">
        {record.bands.map((b) => (
          <tr key={b.band} className="border-t border-line">
            <td className="py-2">
              <p className="font-medium text-ink">{b.band}</p>
              <p className="text-xs text-ink-3">{b.description}</p>
            </td>
            <td className="py-2 text-right text-ink-2">{b.games.toLocaleString()}</td>
            <td className="py-2 pl-4">
              {b.games ? (
                <div className="flex items-center gap-2">
                  <span className="w-12 font-semibold text-ink">{pct(b.accuracy, 1)}</span>
                  <Meter value={b.accuracy} />
                </div>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SeasonTable({ record }: { record: TrackRecord }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-ink-3">
          <th className="pb-2 font-medium">Season</th>
          <th className="pb-2 text-right font-medium">Games</th>
          <th className="pb-2 text-right font-medium">Correct</th>
          <th className="pb-2 text-right font-medium">Brier</th>
        </tr>
      </thead>
      <tbody className="tabular">
        {record.seasons.map((s) => (
          <tr key={s.seasonYear} className="border-t border-line">
            <td className="py-2 font-medium text-ink">{s.label}</td>
            <td className="py-2 text-right text-ink-2">{s.metrics.games.toLocaleString()}</td>
            <td className="py-2 text-right font-semibold text-ink">{pct(s.metrics.accuracy, 1)}</td>
            <td className="py-2 text-right text-ink-2">{s.metrics.brier.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RecordPanel({ league, record }: { league: LeagueConfig; record: TrackRecord }) {
  return (
    <div className="space-y-6">
      <RecordTiles record={record} />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Calibration</h3>
          <p className="mb-2 text-xs text-ink-3">When the forecast says 65%, does that team win about 65% of the time?</p>
          <CalibrationChart buckets={record.calibration} title={`${league.name} calibration`} />
        </div>
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">By confidence</h3>
            <BandTable record={record} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">By season</h3>
            <SeasonTable record={record} />
          </div>
        </div>
      </div>
    </div>
  );
}
