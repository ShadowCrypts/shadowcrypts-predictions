import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeftRight, ChevronLeft } from 'lucide-react';
import { isLeagueId, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { seasonLeaders } from '../../../lib/model/leaders';
import { playerDirectory } from '../../../lib/model/playerIndex';
import { propEngine } from '../../../lib/model/propEngines';
import { displayColor } from '../../../lib/teamColor';
import { PlayerDirectoryList } from '../../components/PlayerDirectoryList';
import { PlayerTable, PlayerTableRow } from '../../components/PlayerTable';
import { EmptyState, PageHeader } from '../../components/Section';
import { StatLeaders } from '../../components/StatLeaders';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string }> };

const COPY = {
  'nba-players': {
    title: 'Player ratings',
    intro:
      "Every player the NBA lineup model rates, best first. A rating is Game Score per 48 minutes with a share of plus-minus, weighted toward recent games and pulled toward average until a player has real minutes. It's what decides how much a team loses when someone sits.",
    ratingLabel: 'Rating',
    ratingHint: 'Game Score per 48 minutes, plus-minus included; the second number is against the league average',
    volumeLabel: 'Min',
    volumeHint: 'Usual minutes per game when healthy',
    decimals: 1
  },
  'nfl-quarterbacks': {
    title: 'Quarterback ratings',
    intro:
      "Every quarterback the NFL model rates, best first. A rating is adjusted net yards per play, his own runs included, weighted toward recent games and pulled below average until he's proven, so a backup with a few good drives doesn't jump the list. The second number is against the average starter. It's what decides how much the forecast moves when a backup starts.",
    ratingLabel: 'Yards per play',
    ratingHint: 'Adjusted net yards per play; the second number is against the average starter (the 32 passers with the most recent plays)',
    volumeLabel: 'Plays',
    volumeHint: 'Recent dropbacks and runs, with older games counting less',
    decimals: 2
  }
} as const;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { league: id } = await params;
  if (!isLeagueId(id)) return {};
  const league = LEAGUES[id];
  if (id === 'nba' || id === 'nfl') {
    return {
      title: `${league.name} ${id === 'nfl' ? 'quarterback' : 'player'} ratings`,
      description: `The ${league.name} player ratings behind ShadowCrypts Predictions' forecasts.`
    };
  }
  return { title: `${league.name} players`, description: `Every ${league.name} player with projections, prop lines and recent games against the line.` };
}

export default async function PlayersPage({ params }: Params) {
  const { league: id } = await params;
  if (!isLeagueId(id)) notFound();
  const league = LEAGUES[id];
  const model = await getLeagueModel(league.id);
  const board = model.players;
  // Without ratings, the league's players with pages (the NHL), busiest first.
  const directory = board ? [] : await playerDirectory(league, model);
  const leaders = await seasonLeaders(league, model);
  const statLeaders = leaders && <StatLeaders league={league} data={leaders} thisSeason={model.season.year} />;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${league.id}`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {league.name}
        </Link>
        {propEngine(league) && (
          <Link href={`/${league.id}/compare`} className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink hover:underline">
            <ArrowLeftRight className="h-4 w-4" aria-hidden /> Compare two players
          </Link>
        )}
      </div>
      {board ? (
        <>
          <PageHeader eyebrow={`${league.name} · ${model.season.label}`} title={COPY[board.kind].title}>
            <p>{COPY[board.kind].intro}</p>
          </PageHeader>
          {statLeaders}
          <PlayerTable
            league={league.id}
            rows={board.rows
              .filter((r) => model.teams[r.teamId])
              .map(
                (r): PlayerTableRow => ({
                  id: r.id,
                  name: r.name,
                  team: {
                    id: r.teamId,
                    abbr: model.teams[r.teamId].abbr,
                    shortName: model.teams[r.teamId].shortName,
                    logo: model.teams[r.teamId].logo,
                    color: displayColor(model.teams[r.teamId].color, model.teams[r.teamId].altColor)
                  },
                  rating: r.rating,
                  vsAverage: r.vsAverage,
                  volume: r.volume
                })
              )}
            ratingLabel={COPY[board.kind].ratingLabel}
            ratingHint={COPY[board.kind].ratingHint}
            volumeLabel={COPY[board.kind].volumeLabel}
            volumeHint={COPY[board.kind].volumeHint}
            decimals={COPY[board.kind].decimals}
          />
        </>
      ) : directory.length ? (
        <>
          <PageHeader eyebrow={`${league.name} · ${model.season.label}`} title="Players">
            <p>
              Every {league.name} player with a page: his projections and prop lines for the next game, and his recent games against the line.
              Busiest first. There&apos;s no rating table here: the {league.name} forecasts rate only each starting goalie, from the goals
              his team allowed in his starts.
            </p>
          </PageHeader>
          {statLeaders}
          <PlayerDirectoryList
            league={league.id}
            rows={directory.map((p) => {
              const team = Object.values(model.teams).find((t) => t.abbr === p.team);
              return { id: p.id, name: p.name, team: p.team, teamName: team?.shortName ?? '', color: team ? displayColor(team.color, team.altColor) : undefined };
            })}
          />
        </>
      ) : (
        <>
          <PageHeader eyebrow={league.name} title="Player ratings">
            <p>
              The {league.name} model doesn&apos;t rate individual players yet. NBA players and NFL quarterbacks have ratings because those
              models beat the team-only version on past seasons.
            </p>
          </PageHeader>
          <EmptyState>
            See the <Link href="/nba/players" className="text-ink underline">NBA player ratings</Link> or the{' '}
            <Link href="/nfl/players" className="text-ink underline">NFL quarterback ratings</Link>.
          </EmptyState>
        </>
      )}
    </div>
  );
}
