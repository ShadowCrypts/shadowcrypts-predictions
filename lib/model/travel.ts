import type { Game } from '../espn';
import type { LeagueId } from '../leagues';
import { etDateKey } from '../time';

type Place = readonly [lat: number, lon: number, utcOffset: number];

// Home metro areas; the UTC offset is standard time.
const CITIES = {
  anaheim: [33.81, -117.88, -8],
  atlanta: [33.76, -84.39, -5],
  baltimore: [39.28, -76.62, -5],
  boston: [42.35, -71.06, -5],
  buffalo: [42.89, -78.88, -5],
  calgary: [51.04, -114.06, -7],
  charlotte: [35.23, -80.84, -5],
  chicago: [41.88, -87.63, -6],
  cincinnati: [39.1, -84.51, -5],
  cleveland: [41.5, -81.69, -5],
  columbus: [39.96, -83.0, -5],
  dallas: [32.78, -96.8, -6],
  denver: [39.74, -104.99, -7],
  detroit: [42.33, -83.05, -5],
  edmonton: [53.55, -113.49, -7],
  greenBay: [44.5, -88.06, -6],
  houston: [29.76, -95.37, -6],
  indianapolis: [39.77, -86.16, -5],
  jacksonville: [30.32, -81.64, -5],
  kansasCity: [39.1, -94.58, -6],
  lasVegas: [36.17, -115.14, -8],
  losAngeles: [34.05, -118.24, -8],
  memphis: [35.15, -90.05, -6],
  miami: [25.76, -80.19, -5],
  milwaukee: [43.04, -87.91, -6],
  minneapolis: [44.98, -93.27, -6],
  montreal: [45.5, -73.57, -5],
  nashville: [36.16, -86.78, -6],
  newOrleans: [29.95, -90.07, -6],
  newYork: [40.75, -73.99, -5],
  oakland: [37.8, -122.27, -8],
  oklahomaCity: [35.46, -97.52, -6],
  orlando: [28.54, -81.38, -5],
  ottawa: [45.42, -75.7, -5],
  philadelphia: [39.9, -75.17, -5],
  phoenix: [33.45, -112.07, -7],
  pittsburgh: [40.44, -80.0, -5],
  portland: [45.52, -122.68, -8],
  raleigh: [35.78, -78.64, -5],
  sacramento: [38.58, -121.49, -8],
  saltLakeCity: [40.76, -111.89, -7],
  sanAntonio: [29.42, -98.49, -6],
  sanDiego: [32.72, -117.16, -8],
  sanFrancisco: [37.77, -122.42, -8],
  sanJose: [37.34, -121.89, -8],
  seattle: [47.61, -122.33, -8],
  stLouis: [38.63, -90.2, -6],
  tampa: [27.95, -82.46, -5],
  toronto: [43.65, -79.38, -5],
  vancouver: [49.28, -123.12, -8],
  washington: [38.9, -77.04, -5],
  winnipeg: [49.9, -97.14, -6]
} satisfies Record<string, Place>;

type City = keyof typeof CITIES;

// By ESPN abbreviation, which changes on relocation (OAK → ATH, ARI → UTAH → UTA in the NHL).
const TEAM_CITY: Record<LeagueId, Record<string, City>> = {
  nfl: {
    ARI: 'phoenix', ATL: 'atlanta', BAL: 'baltimore', BUF: 'buffalo', CAR: 'charlotte', CHI: 'chicago', CIN: 'cincinnati', CLE: 'cleveland',
    DAL: 'dallas', DEN: 'denver', DET: 'detroit', GB: 'greenBay', HOU: 'houston', IND: 'indianapolis', JAX: 'jacksonville', KC: 'kansasCity',
    LAC: 'losAngeles', LAR: 'losAngeles', LV: 'lasVegas', MIA: 'miami', MIN: 'minneapolis', NE: 'boston', NO: 'newOrleans', NYG: 'newYork',
    NYJ: 'newYork', PHI: 'philadelphia', PIT: 'pittsburgh', SEA: 'seattle', SF: 'sanJose', TB: 'tampa', TEN: 'nashville', WSH: 'washington'
  },
  nba: {
    ATL: 'atlanta', BKN: 'newYork', BOS: 'boston', CHA: 'charlotte', CHI: 'chicago', CLE: 'cleveland', DAL: 'dallas', DEN: 'denver',
    DET: 'detroit', GS: 'sanFrancisco', HOU: 'houston', IND: 'indianapolis', LAC: 'losAngeles', LAL: 'losAngeles', MEM: 'memphis', MIA: 'miami',
    MIL: 'milwaukee', MIN: 'minneapolis', NO: 'newOrleans', NY: 'newYork', OKC: 'oklahomaCity', ORL: 'orlando', PHI: 'philadelphia',
    PHX: 'phoenix', POR: 'portland', SA: 'sanAntonio', SAC: 'sacramento', TOR: 'toronto', UTAH: 'saltLakeCity', WSH: 'washington'
  },
  mlb: {
    ARI: 'phoenix', ATH: 'sacramento', ATL: 'atlanta', BAL: 'baltimore', BOS: 'boston', CHC: 'chicago', CHW: 'chicago', CIN: 'cincinnati',
    CLE: 'cleveland', COL: 'denver', DET: 'detroit', HOU: 'houston', KC: 'kansasCity', LAA: 'anaheim', LAD: 'losAngeles', MIA: 'miami',
    MIL: 'milwaukee', MIN: 'minneapolis', NYM: 'newYork', NYY: 'newYork', OAK: 'oakland', PHI: 'philadelphia', PIT: 'pittsburgh',
    SD: 'sanDiego', SEA: 'seattle', SF: 'sanFrancisco', STL: 'stLouis', TB: 'tampa', TEX: 'dallas', TOR: 'toronto', WSH: 'washington'
  },
  nhl: {
    ANA: 'anaheim', ARI: 'phoenix', BOS: 'boston', BUF: 'buffalo', CAR: 'raleigh', CBJ: 'columbus', CGY: 'calgary', CHI: 'chicago',
    COL: 'denver', DAL: 'dallas', DET: 'detroit', EDM: 'edmonton', FLA: 'miami', LA: 'losAngeles', MIN: 'minneapolis', MTL: 'montreal',
    NJ: 'newYork', NSH: 'nashville', NYI: 'newYork', NYR: 'newYork', OTT: 'ottawa', PHI: 'philadelphia', PIT: 'pittsburgh', SEA: 'seattle',
    SJ: 'sanJose', STL: 'stLouis', TB: 'tampa', TOR: 'toronto', UTA: 'saltLakeCity', UTAH: 'saltLakeCity', VAN: 'vancouver',
    VGK: 'lasVegas', WPG: 'winnipeg', WSH: 'washington'
  }
};

function homePlace(league: LeagueId, abbr: string): Place | null {
  const city = TEAM_CITY[league][abbr];
  return city ? CITIES[city] : null;
}

/** Days since the epoch, by the game's Eastern-time calendar date. */
const dayNumber = (iso: string) => Math.round(Date.parse(etDateKey(iso)) / 86_400_000);

/** Time zones each team crossed heading east to reach a game (0 for westward trips, staying put, or unknown neutral sites). */
export type EastwardTrip = { home: number; away: number };

/**
 * Walks the schedule in date order (upcoming games included). A team flies
 * straight from one game to the next when there are at most two days off in
 * between; with more rest it's assumed to have gone home first, so NFL trips
 * always start in the home city.
 */
export function eastwardTrips(games: Game[]): Map<string, EastwardTrip> {
  const last = new Map<string, { day: number; place: Place | null }>();
  const trips = new Map<string, EastwardTrip>();
  for (const game of games) {
    const day = dayNumber(game.date);
    const place = game.neutral ? null : homePlace(game.league, game.home.abbr);
    const zones = (side: Game['home']) => {
      const prev = last.get(side.teamId);
      const origin = prev && day - prev.day - 1 <= 2 ? prev.place : homePlace(game.league, side.abbr);
      return origin && place ? Math.max(0, place[2] - origin[2]) : 0;
    };
    trips.set(game.id, { home: zones(game.home), away: zones(game.away) });
    for (const side of [game.home, game.away]) last.set(side.teamId, { day, place });
  }
  return trips;
}

/** Home-minus-away Elo for the rating replays' `extra` input. */
export function travelAdjustments(trips: Map<string, EastwardTrip>, eloPerZone: number) {
  const adjustments = new Map<string, number>();
  for (const [id, trip] of trips) if (trip.home !== trip.away) adjustments.set(id, eloPerZone * (trip.away - trip.home));
  return adjustments;
}

/** Adds per-game adjustment maps together. */
export function combineAdjustments(...maps: (Map<string, number> | null | undefined)[]) {
  const present = maps.filter((m): m is Map<string, number> => !!m);
  if (present.length <= 1) return present[0];
  const total = new Map<string, number>();
  for (const m of present) for (const [id, v] of m) total.set(id, (total.get(id) ?? 0) + v);
  return total;
}
