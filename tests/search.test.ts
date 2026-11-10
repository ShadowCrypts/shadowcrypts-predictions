import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import { leagueName } from '../lib/leagueName';
import { displayColor, distance, luminance, matchupColors, NEUTRAL } from '../lib/teamColor';
import { LEAGUE_IDS, LEAGUES } from '../lib/leagues';
import { MAX_FOLLOWED, parseFollowed } from '../lib/model/followedPlayers';
import type { LeagueModel } from '../lib/model';
import { appearances, averageForm, usagePercentiles } from '../lib/model/playerIndex';
import { maybeLive } from '../lib/model/playerLog';
import { findGames, findPlayers, GameHit, initials, nameScore, PlayerHit, queryTerms, searchable } from '../lib/search';

const player = (name: string, team: string, usage: number, league: PlayerHit['league'] = 'nba', id = name): PlayerHit => ({ league, id, name, team, usage });
const PLAYERS = [
  player('LeBron James', 'LAL', 20),
  player('Bronny James', 'LAL', 6),
  player('Nikola Jokić', 'DEN', 22),
  player('Jalen Brunson', 'NY', 21),
  player('Jalen Green', 'PHX', 18),
  player('Jalen Hurts', 'PHI', 8, 'nfl'),
  player('Josh Allen', 'BUF', 8, 'nfl'),
  player('Grayson Allen', 'PHX', 15),
  player('Connor McDavid', 'EDM', 14, 'nhl'),
  player("De'Aaron Fox", 'SA', 19)
];
const names = (query: string) => findPlayers(PLAYERS, query).map((p) => p.name);

describe('search matching', () => {
  it('ignores case, accents and punctuation', () => {
    assert.equal(searchable('  Nikola JOKIĆ '), 'nikola jokic');
    assert.equal(searchable("De'Aaron Fox"), 'de aaron fox');
    assert.deepEqual(queryTerms(' jokic,  NIKOLA '), ['jokic', 'nikola']);
  });

  it('finds a player from the start of any part of his name', () => {
    assert.deepEqual(names('jokic'), ['Nikola Jokić']);
    assert.deepEqual(names('mcdav'), ['Connor McDavid']);
    assert.deepEqual(names('jalen br'), ['Jalen Brunson']);
    assert.deepEqual(names('fox'), ["De'Aaron Fox"]);
  });

  it('puts whole-word matches first, then whoever has played the most lately', () => {
    // "allen" is a whole last name for both: the busier one first.
    assert.deepEqual(names('allen'), ['Grayson Allen', 'Josh Allen']);
    assert.deepEqual(names('jalen'), ['Jalen Brunson', 'Jalen Green', 'Jalen Hurts']);
    // "james" matches both as a whole word; "bron" only starts Bronny's first name, while it's inside LeBron.
    assert.deepEqual(names('james'), ['LeBron James', 'Bronny James']);
    assert.deepEqual(names('bron'), ['Bronny James']);
  });

  it('narrows by team or league, but a name always outranks them', () => {
    assert.deepEqual(names('allen nfl'), ['Josh Allen']);
    assert.deepEqual(names('lal'), ['LeBron James', 'Bronny James']);
    assert.ok(nameScore(['allen'], 'Josh Allen') > nameScore(['buf'], 'Josh Allen', 'BUF nfl'));
  });

  it('needs every word to match, and two letters to start', () => {
    assert.deepEqual(names('jalen zzz'), []);
    assert.deepEqual(names('j'), []);
    assert.deepEqual(names(''), []);
    assert.equal(nameScore([], 'Anyone'), 0);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => player(`Smith ${i}`, 'X', i));
    assert.equal(findPlayers(many, 'smith').length, 8);
    assert.equal(findPlayers(many, 'smith', 3)[0].name, 'Smith 29');
  });

  it('makes initials for players without a photo', () => {
    assert.equal(initials('LeBron James'), 'LJ');
    assert.equal(initials('Jaren Jackson Jr.'), 'JJ');
    assert.equal(initials('Nenê'), 'N');
  });
});

describe('finding games', () => {
  const team = (abbr: string, name: string, shortName: string) => ({ abbr, name, shortName });
  const game = (id: string, date: string, away: ReturnType<typeof team>, home: ReturnType<typeof team>, league: GameHit['league'] = 'nba'): GameHit => ({ league, id, date, state: 'pre', away, home });
  const lal = team('LAL', 'Los Angeles Lakers', 'Lakers');
  const lac = team('LAC', 'LA Clippers', 'Clippers');
  const gsw = team('GS', 'Golden State Warriors', 'Warriors');
  const lak = team('LA', 'Los Angeles Kings', 'Kings');
  const games = [game('1', '2026-10-29T02:30:00Z', lal, lac), game('2', '2026-10-28T23:00:00Z', gsw, lal), game('3', '2026-10-29T02:00:00Z', lak, team('SEA', 'Seattle Kraken', 'Kraken'), 'nhl')];

  it('puts the game naming both teams first, then the rest soonest first', () => {
    assert.deepEqual(findGames(games, 'lakers clippers').map((g) => g.id), ['1']);
    assert.deepEqual(findGames(games, 'lakers').map((g) => g.id), ['2', '1']);
    assert.deepEqual(findGames(games, 'clippers lakers').map((g) => g.id), ['1']);
  });

  it('reads cities and abbreviations, and a word every team shares names none', () => {
    assert.deepEqual(findGames(games, 'kraken').map((g) => g.id), ['3']);
    assert.deepEqual(findGames(games, 'lal gs').map((g) => g.id), ['2']);
    assert.deepEqual(findGames(games, 'nba'), []);
    assert.deepEqual(findGames(games, 'zzz'), []);
    assert.deepEqual(findGames(games, 'l'), []);
  });
});

describe('followed players', () => {
  it('takes well-formed keys from leagues with player pages, once each, up to a cap', () => {
    assert.deepEqual(parseFollowed('nba:3112335, nfl:3918298,nba:3112335'), [
      { league: 'nba', id: '3112335' },
      { league: 'nfl', id: '3918298' }
    ]);
    // No player model in baseball; junk, extra parts and huge ids are dropped.
    assert.deepEqual(parseFollowed('mlb:1,xyz:2,nba:abc,nba:1:2,nba:1234567890123456,,nhl:3895074'), [{ league: 'nhl', id: '3895074' }]);
    assert.deepEqual(parseFollowed(null), []);
    const many = Array.from({ length: 100 }, (_, i) => `nba:${i + 1}`).join(',');
    assert.equal(parseFollowed(many).length, MAX_FOLLOWED);
  });
});

describe('team colors', () => {
  it('keep a usable color, and fix ones too dark or too light to see', () => {
    assert.equal(displayColor('#c8102e', null), '#c8102e');
    // Black falls back to the alternate; with no usable alternate, it's lightened into range.
    assert.equal(displayColor('#000000', '#fdb927'), '#fdb927');
    const lifted = displayColor('#000000', '#000000');
    assert.ok(luminance(lifted) >= 0.045 && luminance(lifted) <= 0.7, lifted);
    const dimmed = displayColor('#ffffff', null);
    assert.ok(luminance(dimmed) <= 0.7, dimmed);
    assert.equal(displayColor(null, null), NEUTRAL);
  });

  it('keep two teams in one game apart', () => {
    const { away, home } = matchupColors({ color: '#c8102e' }, { color: '#ce1141', altColor: '#000000' });
    assert.equal(away, '#c8102e');
    assert.ok(distance(away, home) >= 60, home);
    const apart = matchupColors({ color: '#1d428a' }, { color: '#ce1141' });
    assert.deepEqual(apart, { away: '#1d428a', home: '#ce1141' });
  });
});

describe('recent form', () => {
  it('averages each market over the games listed, leaving out markets never logged', () => {
    const form = averageForm(
      new Map([
        ['a', [{ pts: 30, reb: 10 }, { pts: 20, reb: 5 }, { pts: 25 }]],
        ['b', [{ sog: 3 }]]
      ])
    );
    assert.deepEqual(form.get('a'), { pts: 25, reb: 7.5 });
    assert.deepEqual(form.get('b'), { sog: 3 });
  });
});

describe('a team’s game in progress', () => {
  it('considers only games that have started in the last six hours and aren’t final', () => {
    const now = Date.parse('2026-10-28T02:00:00Z');
    const p = (id: string, hoursAgo: number, completed = false) => ({ game: { id, date: new Date(now - hoursAgo * 3_600_000).toISOString(), completed } });
    const model = {
      teamGames: { '7': ['early', 'on', 'done', 'later', 'old'] },
      predictions: { early: p('early', 7), on: p('on', 1.5), done: p('done', 3, true), later: p('later', -2), old: p('old', 30) }
    } as unknown as LeagueModel;
    assert.deepEqual(maybeLive(model, '7', now).map((x) => x.game.id), ['on']);
    assert.deepEqual(maybeLive(model, '8', now), []);
  });
});

describe('league names for the browser', () => {
  it('match the full league settings', () => {
    for (const id of LEAGUE_IDS) assert.equal(leagueName(id), LEAGUES[id].name);
  });
});

describe('player directory', () => {
  it('lists who played in a game once each, skipping anyone who never got on the floor, ice or field', () => {
    const nba: BoxScore = {
      league: 'nba',
      teams: {
        '13': [
          { id: '1', name: 'Plays', min: 30 } as never,
          { id: '2', name: 'Did not play', min: 0 } as never
        ]
      }
    };
    assert.deepEqual([...appearances(nba, null).keys()], ['1']);

    const nhl: BoxScore = {
      league: 'nhl',
      teams: { '6': { skaters: [{ id: '3', name: 'Skater', toi: 18, g: 0, a: 1, sog: 2, bs: 0 }], goalies: [{ id: '4', name: 'Backup', toi: 0, sa: 0, ga: 0 }, { id: '5', name: 'Starter', toi: 60, sa: 30, ga: 2 }] } }
    };
    assert.deepEqual([...appearances(nhl, null).keys()], ['3', '5']);
    // A goalie's full 60 minutes count for about as much as a top skater's 21.
    assert.equal(appearances(nhl, null).get('5')?.usage, 21);

    // A quarterback who passed and ran shows up in both lists, and counts once.
    const nfl: BoxScore = { league: 'nfl', teams: { '21': { starter: null, passers: [{ id: '7', name: 'QB', att: 30 } as never] } as never } };
    const skill: NflSkillBox = {
      teams: {
        '21': [
          { id: '7', name: 'QB', rushAtt: 4, rushYds: 20, rushTd: 0, tgt: 0, rec: 0, recYds: 0, recTd: 0 },
          { id: '8', name: 'WR', rushAtt: 0, rushYds: 0, rushTd: 0, tgt: 6, rec: 4, recYds: 50, recTd: 0 }
        ]
      }
    };
    const seen = appearances(nfl, skill);
    assert.deepEqual([...seen.keys()], ['7', '8']);
    assert.equal(seen.get('8')?.teamId, '21');
    // Involvement: his 30 throws and 4 carries; the receiver's 6 targets.
    assert.equal(seen.get('7')?.usage, 34);
    assert.equal(seen.get('8')?.usage, 6);
    assert.equal(appearances(nba, null).get('1')?.usage, 30);
    assert.equal(appearances(null, null).size, 0);
  });

  it('ranks playing time as a percentile of the league, so leagues with different units compare', () => {
    // An NBA league in minutes and an NFL league in plays: each one's busiest lands at 100.
    const nba = usagePercentiles([10, 120, 300, 300, 40]);
    const nfl = usagePercentiles([200, 30, 8]);
    assert.equal(nba(300), 100);
    assert.equal(nfl(200), 100);
    assert.equal(nba(120), 60);
    assert.equal(nba(10), 20);
    assert.ok(nfl(30) > nfl(8));
    // Nobody lately is 0; anyone who played gets at least 1.
    assert.equal(nba(0), 0);
    assert.equal(usagePercentiles([])(5), 0);
    assert.ok(usagePercentiles(Array.from({ length: 500 }, (_, i) => i + 1))(1) >= 1);
  });
});
