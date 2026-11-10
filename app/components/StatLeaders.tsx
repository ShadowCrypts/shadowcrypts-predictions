import Link from 'next/link';
import { seasonLabel, LeagueConfig } from '../../lib/leagues';
import type { SeasonLeaders } from '../../lib/model/leaders';
import { marketLabel } from '../../lib/props';
import { PlayerPhoto } from './PlayerPhoto';
import { Section } from './Section';

/** The top players per game in the league's main stats, a card for each. */
export function StatLeaders({ league, data, thisSeason }: { league: LeagueConfig; data: SeasonLeaders; thisSeason: number }) {
  const boards = data.boards.filter((b) => b.leaders.length);
  if (!boards.length) return null;
  return (
    <Section
      id="leaders"
      title="Stat leaders"
      bare
      subtitle={`${data.seasonYear === thisSeason ? 'This season' : `Last season (${seasonLabel(league, data.seasonYear)})`}, regular season, ${
        data.by === 'average' ? "per game. Qualifying takes playing 70% of his team's games." : 'season totals.'
      }`}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {boards.map(({ market, leaders }) => (
          <section key={market} className="card min-w-0 p-4" aria-labelledby={`leaders-${market}`}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 id={`leaders-${market}`} className="font-display text-sm font-semibold text-ink first-letter:uppercase">
                {marketLabel(market).long}
              </h3>
              {leaders.length >= 2 && (
                <Link href={`/${league.id}/compare?a=${leaders[0].id}&b=${leaders[1].id}`} className="shrink-0 text-xs text-ink-3 hover:text-ink hover:underline">
                  Compare top two
                </Link>
              )}
            </div>
            <ol>
              {leaders.map((p, i) => (
                <li key={p.id} className="flex items-center gap-2.5 border-t border-line/60 py-1.5 first:border-0">
                  <span className="w-3 shrink-0 text-xs text-ink-3 tabular">{i + 1}</span>
                  <PlayerPhoto league={league.id} id={p.id} name={p.name} size={28} />
                  <span className="min-w-0 flex-1">
                    <Link href={`/${league.id}/player/${p.id}`} className="block truncate text-sm font-medium text-ink hover:underline">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-ink-3 tabular">
                      {p.team ? `${p.team} · ` : ''}
                      {p.games} {p.games === 1 ? 'game' : 'games'}
                    </span>
                  </span>
                  <span className={`shrink-0 font-display text-base tabular ${i === 0 ? 'font-bold text-ink' : 'font-semibold text-ink-2'}`}>
                    {data.by === 'average' ? p.value.toFixed(1) : p.value.toLocaleString('en-US')}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </Section>
  );
}
