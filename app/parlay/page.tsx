import type { Metadata } from 'next';
import { ParlayBuilder } from '../components/ParlayBuilder';
import { QuickAdd } from '../components/QuickAdd';
import { PageHeader, Section } from '../components/Section';
import { TrackedParlays } from '../components/TrackedParlays';

export const metadata: Metadata = {
  title: 'Your parlay',
  description: 'What a parlay is really worth: the chance every leg hits (same-game legs included), fair odds, what the book pays, and a tracker.'
};

/**
 * The same-game test, from `npm run backtest -- --correlations` on Oct 26, 2026:
 * correlations fitted on the earlier half of each league's games with graded
 * prop lines, then random same-game parlays on the later half. "Together" and
 * "against" are parlays where the correlations moved the chance by a quarter
 * or more, up or down.
 */
const TEST = [
  { league: 'NBA', fit: 875, tested: 876, together: [7814, 0.344, 0.201, 0.337], against: [577, 0.05, 0.135, 0.048], all: [31168, 0.242, 0.201, 0.238] },
  { league: 'NHL', fit: 1046, tested: 1046, together: [13403, 0.185, 0.091, 0.187], against: [663, 0.029, 0.069, 0.038], all: [43734, 0.178, 0.148, 0.177] },
  { league: 'NFL', fit: 233, tested: 234, together: [2369, 0.345, 0.229, 0.358], against: [289, 0.052, 0.126, 0.073], all: [7627, 0.227, 0.201, 0.24] }
] as const;

/**
 * The live test, from `npm run backtest -- --live-props` on Oct 26, 2026:
 * settings fitted on the earlier half of games, log loss of legs still open
 * at each break on the later half.
 */
const LIVE_TEST = [
  { league: 'NBA', at: 'After Q1', n: 51407, pregame: 0.686, live: 0.611 },
  { league: 'NBA', at: 'Halftime', n: 47899, pregame: 0.685, live: 0.526 },
  { league: 'NBA', at: 'After Q3', n: 39081, pregame: 0.679, live: 0.439 },
  { league: 'NHL', at: 'After P1', n: 72303, pregame: 0.52, live: 0.493 },
  { league: 'NHL', at: 'After P2', n: 63181, pregame: 0.458, live: 0.359 },
  { league: 'NFL', at: 'After Q1', n: 8601, pregame: 0.689, live: 0.641 },
  { league: 'NFL', at: 'Halftime', n: 7705, pregame: 0.689, live: 0.561 },
  { league: 'NFL', at: 'After Q3', n: 6510, pregame: 0.687, live: 0.466 }
] as const;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function Row({ label, values }: { label: string; values: readonly [number, number, number, number] }) {
  const [n, hit, multiplied, together] = values;
  return (
    <tr className="border-b border-line/60 last:border-0">
      <td className="py-2 pr-3 text-ink-2">{label}</td>
      <td className="py-2 pr-3 text-right text-ink-3">{n.toLocaleString()}</td>
      <td className="py-2 pr-3 text-right font-semibold text-ink">{pct(hit)}</td>
      <td className="py-2 pr-3 text-right text-ink-2">{pct(multiplied)}</td>
      <td className="py-2 text-right font-semibold text-accent-strong">{pct(together)}</td>
    </tr>
  );
}

export default function ParlayPage() {
  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Parlay" title="What your parlay is really worth">
        <p>
          Every leg has to win. Legs from different games multiply; legs from the same game move together, and the chance here accounts
          for that. See the real chance of cashing, the fair price for it and what the book pays before you place it, then track how it
          went.
        </p>
      </PageHeader>
      <QuickAdd />
      <ParlayBuilder />
      <TrackedParlays />
      <Section
        title="How the same-game chances were tested"
        subtitle="How strongly legs move together was fitted on the earlier half of each league's games with graded prop lines. Then random same-game parlays on the later half, games the fit never saw, were priced both ways and checked against what happened."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {TEST.map((t) => (
            <div key={t.league} className="card p-4">
              <p className="font-display font-semibold text-ink">{t.league}</p>
              <p className="text-xs text-ink-3">
                Fitted on {t.fit.toLocaleString()} games, tested on the next {t.tested.toLocaleString()}
              </p>
              <div className="-mx-4 mt-2 overflow-x-auto px-4">
                <table className="w-full min-w-[300px] text-left text-sm tabular">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-3">
                      <th className="py-2 pr-3 font-medium">Parlays</th>
                      <th className="py-2 pr-3 text-right font-medium">n</th>
                      <th className="py-2 pr-3 text-right font-medium">Hit</th>
                      <th className="py-2 pr-3 text-right font-medium">Multiplied</th>
                      <th className="py-2 text-right font-medium">Same-game</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Row label="Legs that move together" values={t.together} />
                    <Row label="Legs that pull apart" values={t.against} />
                    <Row label="All of them" values={t.all} />
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-2">
          Multiplying undercounts parlays whose legs move together (a player&apos;s points with his points + rebounds + assists) by
          nearly half, and overcounts legs that pull apart. The same-game chances landed close to what happened in every league. The one
          kind they didn&apos;t improve in the NBA and NFL was a team to win with two of its players&apos; overs, which came out about
          even. The table on the site is fitted on every graded game. Like every chance here, these are the books&apos; own numbers with
          their margin removed, then combined: insight, not a way to beat the price.
        </p>
      </Section>
      <Section
        title="How the live chances were tested"
        subtitle="Each player's stats were rebuilt quarter by quarter (NBA, NFL) and period by period (NHL) from play-by-play for every graded game, kept only where they add up to the box score: 101,368 NBA lines, 152,849 NHL lines and 16,721 NFL lines."
      >
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[420px] text-left text-sm tabular">
            <caption className="sr-only">Log loss of legs still open at each break, later half of games; lower is better</caption>
            <thead>
              <tr className="border-b border-line text-xs text-ink-3">
                <th className="py-2 pr-3 font-medium">League</th>
                <th className="py-2 pr-3 font-medium">Break</th>
                <th className="py-2 pr-3 text-right font-medium">Legs</th>
                <th className="py-2 pr-3 text-right font-medium">Pregame chance</th>
                <th className="py-2 text-right font-medium">Live chance</th>
              </tr>
            </thead>
            <tbody>
              {LIVE_TEST.map((r) => (
                <tr key={`${r.league}-${r.at}`} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-3 text-ink-2">{r.league}</td>
                  <td className="py-2 pr-3 text-ink-2">{r.at}</td>
                  <td className="py-2 pr-3 text-right text-ink-3">{r.n.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right text-ink-2">{r.pregame.toFixed(3)}</td>
                  <td className="py-2 text-right font-semibold text-accent-strong">{r.live.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-2">
          Log loss of legs still open at each break, on games the fit never saw (lower is better; 0.693 is a coin flip). From the
          pregame chance and the stat at each break, the live chance reads the rest of the game as the pregame pace scaled to the time
          left, with a little of a hot start carried over and less left for everyone in a blowout. Its numbers held up: NBA legs at
          halftime given about 17% hit 16%, about 49% hit 49%, about 82% hit 79%; NFL legs at halftime given about 19% hit 19%, about
          49% hit 52%. In the NHL the fitted touches added almost nothing beyond the time left. In the NFL the score matters too: a team
          behind throws more and runs less, and leaning on that beat leaving it out at halftime (0.574 → 0.561) and after the third
          quarter (0.489 → 0.466). A yardage over already past its line can still lose yards, but 99.6% of them held. Same-game legs
          mid-game combine through the same correlations as before game time, which did slightly better than multiplying in every
          league.
        </p>
      </Section>
    </div>
  );
}
