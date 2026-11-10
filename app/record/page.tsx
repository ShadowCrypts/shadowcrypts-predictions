import type { Metadata } from 'next';
import { pct } from '../../lib/format';
import { LEAGUES } from '../../lib/leagues';
import type { LeagueModel } from '../../lib/model';
import { byStartTime, getAllModels } from '../../lib/model/all';
import { Ledger, readLedger } from '../../lib/model/ledger';
import { BANDS } from '../../lib/model/metrics';
import { formatLongDay } from '../../lib/time';
import { ChanceBar } from '../components/ChanceBar';
import { ChanceRing } from '../components/ChanceRing';
import { RecordPanel } from '../components/RecordPanel';
import { EmptyState, PageHeader, Section } from '../components/Section';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Track record',
  description: 'Every graded prediction, calibration by league, and exactly how the model works.'
};

const RECENT_LOCKS = 10;

type Lock = { start: string; lead: number };

/** How long before its game's scheduled start each graded logged forecast was locked, oldest game first. */
function locksFor(model: LeagueModel, ledger: Ledger): Lock[] {
  return Object.values(model.predictions)
    .filter((p) => p.source === 'logged' && p.correct !== null && ledger[p.game.id])
    .sort(byStartTime)
    .map((p) => ({ start: p.game.date, lead: Date.parse(p.game.date) - Date.parse(ledger[p.game.id].takenAt) }));
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function leadLabel(ms: number) {
  const abs = Math.abs(ms);
  const span = abs < 3_600_000 ? `${Math.round(abs / 60_000)} min` : `${(abs / 3_600_000).toFixed(abs < 24 * 3_600_000 ? 1 : 0)} h`;
  return `${span} ${ms < 0 ? 'after' : 'before'} start`;
}

function LockTiming({ locks }: { locks: Lock[] }) {
  if (!locks.length) return null;
  const leads = locks.map((l) => l.lead);
  return (
    <p className="mt-1 text-xs text-ink-3" title="Median time between the locked forecast and the scheduled start">
      Locked {leadLabel(median(leads))} (median)
      {leads.length > RECENT_LOCKS && (
        <>
          <br />
          Last {RECENT_LOCKS}: {leadLabel(median(leads.slice(-RECENT_LOCKS)))}
        </>
      )}
    </p>
  );
}

/** Picks needed before closing line value is shown as a share. */
const CLV_MIN_PICKS = 30;

/**
 * Closing line value of the logged prop picks, per league: did the book's line
 * move toward the model's side between its first tag and the close?
 */
/** Games before the gap between two forecasts starts to mean much. */
const HEAD_TO_HEAD_MIN = 200;

/** Us against ESPN on the same games, both numbers locked before the start: however it comes out. */
function EspnHeadToHead({ models }: { models: LeagueModel[] }) {
  const rows = models.filter((m) => m.record.espn);
  if (!rows.length) return null;
  const since = rows.flatMap((m) => (m.record.espn?.since ? [m.record.espn.since] : [])).sort()[0];
  const games = rows.reduce((s, m) => s + (m.record.espn?.games ?? 0), 0);
  return (
    <Section
      id="espn"
      title="Against ESPN's forecasts"
      subtitle={`ESPN publishes its own win chance for NBA, NFL and MLB games. We read it before each game and lock it next to ours, then grade both on the same games, whichever way it comes out. It has to run forward: ESPN re-saves its numbers after games, so looking them up later wouldn't be a fair test. Running since ${since ? formatLongDay(since) : 'now'}.`}
    >
      {games ? (
        <>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[480px] text-sm tabular">
              <caption className="sr-only">Our locked forecasts against ESPN&apos;s, by league</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    League
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Games
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Ours called
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    ESPN called
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium" title="Lower is better: it punishes confident misses">
                    Ours log loss
                  </th>
                  <th scope="col" className="py-2 text-right font-medium" title="Lower is better: it punishes confident misses">
                    ESPN log loss
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const r = m.record.espn!;
                  return (
                    <tr key={m.league} className="border-b border-line/60 last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">
                        {LEAGUES[m.league].name}
                      </th>
                      <td className="py-2 pr-3 text-right text-ink-2">{r.games}</td>
                      <td className="py-2 pr-3 text-right text-ink">{r.games ? `${r.ours.correct} (${pct(r.ours.accuracy, 1)})` : '—'}</td>
                      <td className="py-2 pr-3 text-right text-ink">{r.games ? `${r.espn.correct} (${pct(r.espn.accuracy, 1)})` : '—'}</td>
                      <td className="py-2 pr-3 text-right text-ink">{r.games ? r.ours.logLoss.toFixed(3) : '—'}</td>
                      <td className="py-2 text-right text-ink">{r.games ? r.espn.logLoss.toFixed(3) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {games < HEAD_TO_HEAD_MIN && (
            <p className="mt-3 text-xs text-ink-3">
              {games} {games === 1 ? 'game' : 'games'} so far. Too few to mean much: over a few hundred games the gap between two good forecasts is often a fraction of a percent, so read this as a start.
            </p>
          )}
        </>
      ) : (
        <EmptyState>The first locked pairs grade once tonight&apos;s games are final.</EmptyState>
      )}
    </Section>
  );
}

function ClvNote({ models }: { models: LeagueModel[] }) {
  const rows = models.flatMap((m) => (m.record.propsLive?.clv ? [{ league: m.league, clv: m.record.propsLive.clv }] : []));
  if (!rows.length) return null;
  return (
    <p className="mt-2 text-xs text-ink-3">
      <span className="font-medium text-ink-2">Closing line value</span>, the standard test of whether picks know something before the market
      does: from November 2, 2026, each logged pick keeps the line it was first tagged at, and once the game is played it&apos;s checked
      against the book&apos;s closing line.{' '}
      {rows
        .map(({ league, clv }) =>
          clv.picks >= CLV_MIN_PICKS
            ? `${LEAGUES[league].name}: of ${clv.picks}, the line moved toward the model's side on ${clv.beat} (${pct(clv.beat / clv.picks)}), away on ${clv.worse} (${pct(clv.worse / clv.picks)})`
            : `${LEAGUES[league].name}: ${clv.picks} ${clv.picks === 1 ? 'pick' : 'picks'} so far`
        )
        .join('; ')}
      . Picks the line moves toward more often than away from are finding something before the market; otherwise the model is just following it.
    </p>
  );
}

export default async function RecordPage() {
  const { models } = await getAllModels();
  const ledgers = await Promise.all(models.map((m) => readLedger(m.league)));
  const locks = models.map((m, i) => locksFor(m, ledgers[i]));
  const games = models.reduce((s, m) => s + m.record.overall.games, 0);
  const correct = models.reduce((s, m) => s + m.record.overall.correct, 0);
  const modelOnly = models.reduce((s, m) => s + m.record.modelOnly.correct, 0);
  const preLine = models.reduce((s, m) => s + m.record.preLine.correct, 0);
  // Picking the home team every time, as a count of games, for the same comparison.
  const homeBaseline = models.reduce((s, m) => s + m.record.overall.homeBaseline * m.record.overall.games, 0);
  const liveGames = models.reduce((s, m) => s + m.record.live.metrics.games, 0);
  const liveCorrect = models.reduce((s, m) => s + m.record.live.metrics.correct, 0);
  const totalGames = models.reduce((s, m) => s + Object.keys(m.predictions).length, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Track record"
        title={
          <>
            Graded, <span className="text-gradient">game by game</span>
          </>
        }
        aside={
          games > 0 && (
            <div className="card relative shrink-0 overflow-hidden px-6 py-5 lg:min-w-[440px]">
              <span className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-accent/20 blur-3xl" aria-hidden />
              <div className="relative flex items-center gap-5">
                <ChanceRing value={correct / games} size={128} label="Forecasts correct, all leagues" caption="correct" decimals={1} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">Forecasts correct, all leagues</p>
                  <p className="text-xs text-ink-3">
                    {correct.toLocaleString()} of {games.toLocaleString()} games
                  </p>
                  {/* How each way of picking does on the same games: the forecast against what it's built from and the no-skill baseline. */}
                  <dl className="mt-3 space-y-1.5 text-xs">
                    {[
                      { label: 'Forecast', value: correct / games, strong: true },
                      { label: 'Before the line', value: preLine / games },
                      { label: 'Elo alone', value: modelOnly / games },
                      { label: 'Always home', value: homeBaseline / games }
                    ].map((row) => (
                      <div key={row.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
                        <dt className={row.strong ? 'font-medium text-ink' : 'text-ink-3'}>{row.label}</dt>
                        <dd className="flex items-center gap-2">
                          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
                            <span
                              className={`block h-full rounded-full ${row.strong ? 'bg-gradient-to-r from-accent to-accent-2' : 'bg-ink-3/50'}`}
                              style={{ width: `${(Math.max(0, (row.value - 0.4) / 0.3) * 100).toFixed(1)}%` }}
                            />
                          </span>
                          <span className={`w-12 text-right tabular ${row.strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>{pct(row.value, 1)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-1.5 text-[10px] text-ink-3">Bars run from 40% to 70%.</p>
                </div>
              </div>
            </div>
          )
        }
      >
        <p className="max-w-2xl">
          Each game is scored against the forecast the app would have shown beforehand: the closing betting line where one was posted,
          otherwise the pre-line forecast, which only knows games played before it. Nothing is cherry-picked. Every regular-season and
          playoff game in the window counts.
        </p>
        <p className="mt-3 text-sm">
          Check it yourself: download every graded game as a spreadsheet,{' '}
          <a href="/api/graded" download className="text-accent-strong underline underline-offset-2">
            all leagues
          </a>
          {(['nfl', 'nba', 'mlb', 'nhl'] as const).map((id) => (
            <span key={id}>
              {' · '}
              <a href={`/api/graded?league=${id}`} download className="text-accent-strong underline underline-offset-2">
                {id.toUpperCase()}
              </a>
            </span>
          ))}{' '}
          (CSV: the forecast, the pick and whether it won).
        </p>
        <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Sections">
          {[
            ['#logged', 'Logged forecasts'],
            ['#espn', "Against ESPN's"],
            ...models.map((m) => [`#${m.league}`, LEAGUES[m.league].name]),
            ['#methodology', 'How the model works']
          ].map(([href, label]) => (
            <a key={href} href={href} className="chip chip-idle">
              {label}
            </a>
          ))}
        </nav>
      </PageHeader>

      <Section
        id="logged"
        title="Logged live forecasts"
        subtitle="The forward-tested record: forecasts locked at the last refresh before each game started, using the line available at the time plus injury news, then graded when the game went final. Lock times show how close to the start that refresh was."
      >
        {liveGames ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative overflow-hidden rounded-xl bg-accent/10 p-3 ring-1 ring-accent/40">
              <p className="text-xs text-ink-2">All leagues</p>
              <p className="mt-1 font-display text-2xl font-bold text-ink tabular">
                {liveCorrect}–{liveGames - liveCorrect}
              </p>
              <p className="text-xs text-ink-3">{pct(liveCorrect / liveGames, 1)} correct</p>
              <ChanceBar chance={liveCorrect / liveGames} width="w-full" />
              <LockTiming locks={locks.flat().sort((a, b) => a.start.localeCompare(b.start))} />
            </div>
            {models.map((m, i) => (
              <div key={m.league} className="rounded-xl bg-raised p-3 ring-1 ring-line">
                <p className="text-xs text-ink-2">{LEAGUES[m.league].name}</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink tabular">
                  {m.record.live.metrics.correct}–{m.record.live.metrics.games - m.record.live.metrics.correct}
                </p>
                <p className="text-xs text-ink-3">{m.record.live.metrics.games ? `${pct(m.record.live.metrics.accuracy, 1)} correct` : 'No graded picks yet'}</p>
                {m.record.live.metrics.games > 0 && <ChanceBar chance={m.record.live.metrics.accuracy} width="w-full" />}
                <LockTiming locks={locks[i]} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>Logging has started. Forecasts lock when games begin and appear here once they&apos;re final.</EmptyState>
        )}
      </Section>

      <EspnHeadToHead models={models} />

      {models.map((m) => (
        <Section
          key={m.league}
          id={m.league}
          title={LEAGUES[m.league].fullName}
          subtitle={`${m.record.seasons.map((s) => s.label).join(', ')} · ${m.record.overall.games.toLocaleString()} graded games`}
        >
          <RecordPanel league={LEAGUES[m.league]} record={m.record} />
        </Section>
      ))}

      <Section id="methodology" title="How the model works">
        <div className="grid gap-8 text-sm leading-6 text-ink-2 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-ink">1. Real results in</h3>
              <p>
                Schedules, final scores, injury reports and DraftKings lines come from ESPN&apos;s public feeds. For each league the model replays
                the last three full seasons plus the current one, {totalGames.toLocaleString()} games in all. The oldest season is a warm-up and is
                never graded.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">2. Elo ratings</h3>
              <p>
                Every team starts at 1500. After each game, the winner takes rating points from the loser: more for an upset, more for a lopsided
                score, but with diminishing returns so favorites can&apos;t pad their rating by running up the score (FiveThirtyEight&apos;s
                margin-of-victory formulas). Between seasons each rating moves partway back toward 1500, because rosters change.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">3. Game context</h3>
              <p>
                Home field is worth a fixed number of points (zero at neutral sites like international games). NBA and NHL teams on the second
                night of a back-to-back lose points too. In MLB and the NHL, every starting pitcher and goalie is rated from the runs or goals
                their team allowed in their starts, compared with the team&apos;s usual starter, so an ace or a backup goalie moves the number.
                The rating gap converts to a win probability with the standard Elo curve: a 100-point edge is about 64%.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">4. Injuries</h3>
              <p>
                In the final days before a game, players on the injury report are weighted by their chance of sitting (Out 100%, Doubtful 80%,
                Day-to-day 40%, Questionable 35%) and by their importance. In the NFL that means being the team&apos;s rushing or receiving
                leader. In the NHL it means how often the player led the team in points over its last 10 games. A player who&apos;s been out
                for weeks scores near zero, since the rating already reflects the absence. ESPN doesn&apos;t publish historical injury reports,
                so these can&apos;t be backtested and are kept deliberately small. The NBA uses the lineup model below instead, and NFL
                quarterbacks have a model of their own.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">5. Anchored on the market</h3>
              <p>
                We blended the rating model with closing betting lines (bookmaker margin removed) and fitted the weight on the first graded season
                of each league. The market carried everything the ratings knew and more: the best weight for the ratings was zero in the NBA, MLB
                and NHL, and 7.5% in the NFL. Later seasons held that up in the NBA, MLB and NHL. NFL seasons are under 300 games, so that 7.5%
                is the least certain number here. Once a line is posted, the forecast follows it. The Elo ratings still drive the power
                rankings, every factor breakdown and the ratings-vs-line board.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">6. Before the line</h3>
              <p>
                Lines usually go up a day or so ahead, so games further out need a forecast of their own. A second set of ratings learns how
                the market priced each team: after every game, both teams move toward the gap its closing line implied. In MLB and the NHL
                each starting pitcher and goalie gets the same treatment. Those market-implied ratings soak up roster moves and injuries that
                results alone are slow to show. Blended with Elo, they beat Elo alone on probability quality in every league, most clearly in
                the NBA and NHL. Their settings were fitted on the first graded season only, like everything else.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">7. Who&apos;s playing (NBA)</h3>
              <p>
                Every player is rated from four seasons of box scores: Game Score per 48 minutes plus a share of plus-minus, weighted toward
                recent games and pulled toward average until a player has real minutes. Each game&apos;s lineup strength is the available
                players&apos; ratings weighted by their usual minutes, with an absent player&apos;s minutes handed to the rest, leaning toward the
                bench, and a full roster&apos;s extra minutes coming partly off the end of the bench (both fitted on 2024-25 box scores, which
                cut the minutes missed and helped the later seasons&apos; forecasts). The forecast
                moves by how that lineup compares with the ones the team has been playing lately, so a star sitting tonight lowers it and a
                star coming back raises it. Both rating systems learn net of lineups, so a loss without the star doesn&apos;t cost the team
                rating. In testing, availability comes from each game&apos;s box score (players listed as out for injury, illness or rest),
                which matches the final injury report before tip-off; live forecasts use ESPN&apos;s injury report and current rosters. On the
                held-out seasons it cut the gap between our pre-line forecasts and the betting line by about half. We tried the same idea for
                NHL goalies (save percentage on shots faced) and it didn&apos;t beat what the model already does, so it isn&apos;t used.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">8. Starting quarterbacks (NFL)</h3>
              <p>
                Every passer is rated on adjusted net yards per play: passing yards plus 20 per touchdown, minus 45 per interception and the
                yards lost to sacks, with his own runs counted too. Ratings weight recent games more and start an unproven quarterback well
                below average, so a backup has to earn his way up. Each game compares the starter with the quarterbacks the team has been
                starting, using everyone&apos;s current rating: a backup starting lowers the forecast, the starter coming back raises it, and
                the usual starter&apos;s hot or cold streak isn&apos;t counted twice. Both rating systems learn net of it, and it replaced the
                old rule that a starting QB is worth about 3 points. In testing, the starter is ESPN&apos;s listed starter for each game;
                live forecasts use ESPN&apos;s depth chart and injury report, with a questionable starter weighted by his chance of playing.
                The settings were fitted on 2024 against that season&apos;s closing lines, which already price who starts. On the held-out
                seasons it cut the gap between our pre-line forecasts and the line by about three quarters. We settled on this version
                after a first one did worse on those seasons, so they aren&apos;t a fully untouched test for it. The clean check is 2022, a
                season it never saw: probabilities improved there, though fewer picks were right. NFL seasons are short, so treat the size
                of the gain as rough.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">9. Travel and schedule</h3>
              <p>
                NBA teams that crossed time zones heading east to reach a game lose {LEAGUES.nba.elo.eastZones} Elo per zone (about{' '}
                {((LEAGUES.nba.elo.eastZones ?? 0) / (LEAGUES.nba.elo.eloPerPoint ?? 1)).toFixed(1)} points) for body-clock lag. On a road trip a
                team flies straight from one game to the next; with more than two days off it&apos;s assumed to have gone home first. We also
                tested rest days beyond back-to-backs, three games in four nights, road-trip length, travel distance and eastward travel in the
                other leagues, each fitted on the first graded season. None improved the later seasons, so none is used. Neither did blending
                in ESPN&apos;s Matchup Predictor for MLB games before the line, even though its snapshots are taken the morning of each game.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">10. Live win probability</h3>
              <p>
                During a game, the pregame forecast sets how many points, goals or runs the home team was expected to win by, and whatever
                is left of the game adds a normal spread of outcomes sized to the time remaining. Early on the forecast dominates; late, the
                scoreboard does. Each league&apos;s spread was fitted on the first graded season&apos;s quarter-by-quarter (or period, or
                inning) scores and checked on the later seasons. There it beat both the score alone and the pregame forecast alone at every
                checkpoint: in the NBA, 72% of leaders were called right after the first quarter (the score alone: 64%) and 83% after the
                third. Its percentages held up too. It doesn&apos;t see possession, field position, power plays or who&apos;s on base, so
                it&apos;s a little less sharp than a play-by-play model in the last few minutes. Live numbers are never graded in the track
                record; only pregame forecasts are.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">11. Projected scores</h3>
              <p>
                Each team gets an offense and a defense rating: how many points (goals, runs) above the league average it scores, and allows.
                After every game both move by a small share of the surprise, and in MLB and the NHL each home venue learns its own effect on
                scoring. A
                game&apos;s total is the two offenses against the two defenses. The margin is the posted spread where there is one, otherwise
                the forecast turned into points, so the projected winner is always the forecast&apos;s pick. Once an over/under is posted it
                replaces the model&apos;s total: it was clearly more accurate in football, basketball and baseball, and in hockey nothing beats
                the league average by more than a hair. In football and basketball the
                model&apos;s totals beat the league average by a clear margin and land close to the posted total. In MLB they&apos;re barely
                better than the average, since they don&apos;t know the starting pitchers, and in the NHL team ratings didn&apos;t help at all,
                so its totals are the league average plus each rink&apos;s effect.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">12. Player props</h3>
              <p>
                Every projection uses only earlier games and assumes the player plays, since props are void if he doesn&apos;t. Each league
                was tuned on its first graded season and graded against real DraftKings and ESPN BET lines after that.
              </p>
              <p className="mt-2">
                <span className="text-ink">NBA.</span> Minutes come from the lineup model, so an absent teammate&apos;s minutes go to the
                rest of the rotation; production per minute comes from box scores, and points and assists lean toward the team&apos;s
                implied scoring. The projections beat a player&apos;s season average and last ten games for every stat but blocks. Against
                the books they lost: the book&apos;s number was more accurate, and betting the model&apos;s big disagreements lost about
                the book&apos;s margin.
              </p>
              <p className="mt-2">
                <span className="text-ink">NHL.</span> Ice time and goals, assists, shots and blocked shots per minute, with goals and assists
                leaning toward the team&apos;s implied goals and shots toward its expected shots. A goalie&apos;s saves follow the shots
                he&apos;s expected to face; his own save percentage didn&apos;t help. Points, goals and assists are close to coin flips and
                the model only ties a player&apos;s averages there, but it beats them on shots and saves. Against the books it was nearly
                even, and its big disagreements, mostly unders, made money on both the tuning season and later ones. That fits a known
                lean in prop lines toward the over, but the sample is a few thousand bets, so treat it as promising, not proven.
              </p>
              <p className="mt-2">
                <span className="text-ink">NFL.</span> Each player&apos;s share of his team&apos;s targets and carries times its usual volume,
                with an absent regular&apos;s share handed to the rest; quarterbacks from their team&apos;s pass attempts and their own
                rates. It clearly beats season averages for quarterbacks and slightly for receivers. Against ESPN BET&apos;s lines (DraftKings
                keeps no prices on finished NFL props) it lost on accuracy and its big disagreements came out about even.
              </p>
              <p className="mt-2">
                So prop chances on this site follow the book&apos;s own number with its margin removed, plus the model&apos;s small fitted
                weight, and lines where the model disagrees by 10+ points are tagged with how such lines have done in that league. From
                October 26, 2026, every tagged line is also logged within a day of its game, at the line and price on offer, and graded
                after: the forward test in the table above, which no amount of tuning can flatter. A parlay multiplies every leg&apos;s
                margin, which the parlay page shows before you place one.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-ink">Head to head, all graded games</h3>
              <table className="mt-2 w-full text-left text-xs tabular">
                <thead>
                  <tr className="text-ink-3">
                    <th className="py-1 font-medium">League</th>
                    <th className="py-1 text-right font-medium">Forecast</th>
                    <th className="py-1 text-right font-medium">Before line</th>
                    <th className="py-1 text-right font-medium">Elo alone</th>
                    <th className="py-1 text-right font-medium">Market alone</th>
                    <th className="py-1 text-right font-medium">Lines on file</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.league} className="border-t border-line text-ink-2">
                      <td className="py-1.5 font-medium text-ink">{LEAGUES[m.league].name}</td>
                      <td className="py-1.5 text-right font-semibold text-ink">{pct(m.record.overall.accuracy, 1)}</td>
                      <td className="py-1.5 text-right">{pct(m.record.preLine.accuracy, 1)}</td>
                      <td className="py-1.5 text-right">{pct(m.record.modelOnly.accuracy, 1)}</td>
                      <td className="py-1.5 text-right">{m.record.marketOnly.games ? pct(m.record.marketOnly.accuracy, 1) : '—'}</td>
                      <td className="py-1.5 text-right">{pct(m.record.marketCoverage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="mt-4 w-full text-left text-xs tabular">
                <caption className="mb-1 text-left text-ink-3">Probability quality (log loss, lower is better)</caption>
                <thead>
                  <tr className="text-ink-3">
                    <th className="py-1 font-medium">League</th>
                    <th className="py-1 text-right font-medium">Forecast</th>
                    <th className="py-1 text-right font-medium">Before line</th>
                    <th className="py-1 text-right font-medium">Elo alone</th>
                    <th className="py-1 text-right font-medium">Market alone</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.league} className="border-t border-line text-ink-2">
                      <td className="py-1.5 font-medium text-ink">{LEAGUES[m.league].name}</td>
                      <td className="py-1.5 text-right font-semibold text-ink">{m.record.overall.logLoss.toFixed(3)}</td>
                      <td className="py-1.5 text-right">{m.record.preLine.logLoss.toFixed(3)}</td>
                      <td className="py-1.5 text-right">{m.record.modelOnly.logLoss.toFixed(3)}</td>
                      <td className="py-1.5 text-right">{m.record.marketOnly.games ? m.record.marketOnly.logLoss.toFixed(3) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="mt-4 w-full text-left text-xs tabular">
                <caption className="mb-1 text-left text-ink-3">
                  Projected scores: average miss (lower is better). The game total is compared on games with a posted over/under.
                </caption>
                <thead>
                  <tr className="text-ink-3">
                    <th className="py-1 font-medium">League</th>
                    <th className="py-1 text-right font-medium" title="Each team's projected score against its real one, as shown on game pages">
                      Each team
                    </th>
                    <th className="py-1 text-right font-medium">Total: model</th>
                    <th className="py-1 text-right font-medium">Over/under</th>
                    <th className="py-1 text-right font-medium">League avg</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => {
                    const s = m.record.scores;
                    const unit = LEAGUES[m.league].scoreUnit;
                    return (
                      <tr key={m.league} className="border-t border-line text-ink-2">
                        <td className="py-1.5 font-medium text-ink">{LEAGUES[m.league].name}</td>
                        <td className="py-1.5 text-right font-semibold text-ink">
                          {s.games ? `${s.teamMiss.toFixed(1)} ${unit}` : '—'}
                        </td>
                        <td className="py-1.5 text-right">{s.totals.games ? s.totals.model.toFixed(2) : '—'}</td>
                        <td className="py-1.5 text-right">{s.totals.games ? s.totals.market.toFixed(2) : '—'}</td>
                        <td className="py-1.5 text-right">{s.totals.games ? s.totals.average.toFixed(2) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {models.some((m) => m.record.props?.lines) && (
              <div>
                <h3 className="font-semibold text-ink">Player props against the sportsbook</h3>
                <table className="mt-2 w-full text-left text-xs tabular">
                  <caption className="mb-1 text-left text-ink-3">
                    Main over/under lines from DraftKings and ESPN BET, players who played. Log loss: lower is better, 0.693 is a coin flip.
                  </caption>
                  <thead>
                    <tr className="text-ink-3">
                      <th className="py-1 font-medium">League</th>
                      <th className="py-1 text-right font-medium">Lines</th>
                      <th className="py-1 text-right font-medium">Our model</th>
                      <th className="py-1 text-right font-medium">Book</th>
                      <th className="py-1 text-right font-medium" title="Betting the side our model liked by 10+ points over the price, at the closing price">
                        Model&apos;s big disagreements
                      </th>
                      <th className="py-1 text-right font-medium" title="The same disagreements, logged before each game at the line on offer then, and graded after">
                        Logged before games
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {models
                      .filter((m) => m.record.props?.lines)
                      .map((m) => {
                        const p = m.record.props!;
                        return (
                          <tr key={m.league} className="border-t border-line text-ink-2">
                            <td className="py-1.5 font-medium text-ink">{LEAGUES[m.league].name}</td>
                            <td className="py-1.5 text-right">{p.lines.toLocaleString()}</td>
                            <td className="py-1.5 text-right">{p.logLoss.model.toFixed(3)}</td>
                            <td className="py-1.5 text-right font-semibold text-ink">{p.logLoss.book.toFixed(3)}</td>
                            <td className="py-1.5 text-right">
                              {p.betting.bets.toLocaleString()} bets, {pct(p.betting.won / Math.max(1, p.betting.bets), 1)} won,{' '}
                              <span className={p.betting.returnPerBet >= 0 ? 'text-good' : 'text-bad'}>
                                {p.betting.returnPerBet >= 0 ? '+' : '−'}
                                {Math.abs(p.betting.returnPerBet * 100).toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-1.5 text-right">
                              {m.record.propsLive?.bets ? (
                                <>
                                  {m.record.propsLive.won}–{m.record.propsLive.lost},{' '}
                                  <span className={m.record.propsLive.returnPerBet >= 0 ? 'text-good' : 'text-bad'}>
                                    {m.record.propsLive.returnPerBet >= 0 ? '+' : '−'}
                                    {Math.abs(m.record.propsLive.returnPerBet * 100).toFixed(1)}%
                                  </span>
                                </>
                              ) : m.record.propsLive?.pending ? (
                                `${m.record.propsLive.pending} pending`
                              ) : (
                                'Starting now'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                <ClvNote models={models} />
              </div>
            )}
            <div>
              <h3 className="font-semibold text-ink">Settings by league</h3>
              <table className="mt-2 w-full text-left text-xs tabular">
                <thead>
                  <tr className="text-ink-3">
                    <th className="py-1 font-medium">League</th>
                    <th className="py-1 text-right font-medium">K</th>
                    <th className="py-1 text-right font-medium">Home field</th>
                    <th className="py-1 text-right font-medium">Back-to-back</th>
                    <th className="py-1 text-right font-medium">Regression</th>
                    <th className="py-1 text-right font-medium">Starters</th>
                    <th className="py-1 text-right font-medium" title="Elo's weight next to the market once a line is posted">
                      Elo w/ line
                    </th>
                    <th className="py-1 text-right font-medium" title="Elo's weight next to market-implied ratings before a line is posted">
                      Elo pre-line
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(LEAGUES).map((l) => (
                    <tr key={l.id} className="border-t border-line text-ink-2">
                      <td className="py-1.5 font-medium text-ink">{l.name}</td>
                      <td className="py-1.5 text-right">{l.elo.k}</td>
                      <td className="py-1.5 text-right">{l.elo.hfa}</td>
                      <td className="py-1.5 text-right">{l.elo.backToBack ? `−${l.elo.backToBack}` : '—'}</td>
                      <td className="py-1.5 text-right">{pct(l.elo.regress)}</td>
                      <td className="py-1.5 text-right">{l.elo.starter ? `${l.elo.starter.eloPerUnit}/${l.scoreUnit === 'goals' ? 'goal' : 'run'}` : '—'}</td>
                      <td className="py-1.5 text-right">{pct(l.modelShare, 1)}</td>
                      <td className="py-1.5 text-right">{pct(l.preLine.ratingsShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-ink-3">
                Tuned on the first graded season only (by log loss). Later seasons are a holdout the settings never saw, with one exception:
                the NFL quarterback model&apos;s design was chosen after seeing them (see section 8).
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">Confidence bands</h3>
              <ul className="mt-1 space-y-0.5">
                {BANDS.map((b) => (
                  <li key={b.band}>
                    <span className="font-medium text-ink">{b.band}</span>: {b.description}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-ink">Reading the scores</h3>
              <p>
                <span className="text-ink">Picks correct</span> is how often the favored team won. <span className="text-ink">Brier score</span>{' '}
                measures whether the probabilities themselves were right (0.25 is a coin flip; lower is better).{' '}
                <span className="text-ink">Calibration</span> checks the stated confidence: if 70% picks win about 70% of the time, the percentages
                mean what they say.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-ink">The honest ceiling</h3>
              <p>
                Closing lines are the most accurate public forecast there is, because they absorb depth charts, weather, lineup news and
                millions of dollars of opinion. No public model reliably beats them, so expect roughly 65–70% in football and basketball and
                55–60% in baseball and hockey, where single games are closer to coin flips. Anyone promising much more is selling something.
                Backtests grade against closing lines; live forecasts use the line at the time, which is usually a little less sharp. The
                logged record above measures exactly that. Use the numbers for insight, not as betting advice.
              </p>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
