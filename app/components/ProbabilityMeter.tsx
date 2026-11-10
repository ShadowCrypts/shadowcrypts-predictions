import { pctCapped as pct } from '../../lib/format';

type Props = {
  awayAbbr: string;
  homeAbbr: string;
  homeProb: number;
  pick: 'home' | 'away';
  /** Draws a tick at a second estimate (for example the rating model alone). */
  marker?: { homeProb: number; label: string } | null;
  size?: 'sm' | 'lg' | 'xl';
  /** Hide the percentage labels when the card already shows them. */
  bare?: boolean;
  /** Each side in its team's color (the pick at full strength); without them, the brand gradient on the pick. */
  colors?: { away: string; home: string } | null;
};

const HEIGHT = { sm: 'h-1.5', lg: 'h-3', xl: 'h-4' } as const;

/** Away share on the left, home on the right; the pick is the filled side. */
export function ProbabilityMeter({ awayAbbr, homeAbbr, homeProb, pick, marker, size = 'sm', bare = false, colors = null }: Props) {
  const awayProb = 1 - homeProb;
  const label = (abbr: string, prob: number, picked: boolean) => (
    <span className={picked ? 'font-semibold text-ink' : 'text-ink-3'}>
      {abbr} <span className="tabular">{pct(prob)}</span>
    </span>
  );
  const brand = 'bg-gradient-to-r from-accent to-accent-strong';
  // A team's color as a bar: full when it's the pick, faded when not, with a soft sheen on top.
  const teamFill = (color: string, picked: boolean) => ({
    backgroundImage: `linear-gradient(180deg, rgb(255 255 255 / 0.22), rgb(255 255 255 / 0) 60%), linear-gradient(90deg, ${color}, ${color})`,
    opacity: picked ? 1 : 0.38
  });

  return (
    <div>
      {!bare && (
        <div className={`mb-1.5 flex justify-between ${size === 'sm' ? 'text-xs' : 'text-base'}`}>
          {label(awayAbbr, awayProb, pick === 'away')}
          {label(homeAbbr, homeProb, pick === 'home')}
        </div>
      )}
      <div
        className={`relative flex ${HEIGHT[size]} gap-[3px]`}
        role="img"
        aria-label={`${awayAbbr} ${pct(awayProb)}, ${homeAbbr} ${pct(homeProb)}${marker ? `; ${marker.label}: ${homeAbbr} ${pct(marker.homeProb)}` : ''}`}
      >
        <div
          className={`rounded-l-full transition-[width] duration-700 ease-out ${colors ? '' : pick === 'away' ? brand : 'bg-track'}`}
          style={{ width: `${(awayProb * 100).toFixed(1)}%`, ...(colors ? teamFill(colors.away, pick === 'away') : {}) }}
        />
        <div className={`flex-1 rounded-r-full ${colors ? '' : pick === 'home' ? brand : 'bg-track'}`} style={colors ? teamFill(colors.home, pick === 'home') : undefined} />
        {marker && (
          <span
            className="absolute -bottom-1.5 -top-1.5 w-[3px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface"
            style={{ left: `${(1 - marker.homeProb) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}
