import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameCenter } from '../app/components/GameCenter';
import type { GameSide } from '../lib/espn';
import type { GameCenter as Center, Play } from '../lib/gamecenter';

const side = (teamId: string, abbr: string) => ({ teamId, abbr, shortName: abbr, name: abbr, logo: null }) as unknown as GameSide;
const away = side('1', 'AWY');
const home = side('2', 'HOM');
const play = (text: string, scoring = false): Play => ({ period: 'Q1', clock: '5:00', text, awayScore: 0, homeScore: 0, teamId: '1', scoring });
const center = (over: Partial<Center> = {}): Center => ({ leaders: [{ teamId: '1', performers: [{ category: 'Passing', name: 'QB', value: '10/12', id: null }] }], scoring: [play('A touchdown', true)], recent: [play('A short run')], ...over });
const show = (c: Center, live: boolean, league = 'nfl') => renderToStaticMarkup(createElement(GameCenter, { center: c, away, home, live, league }));

describe('the game center panel', () => {
  it('shows the latest plays above the scoring summary while a game is on', () => {
    const html = show(center(), true);
    assert.ok(html.indexOf('Latest plays') >= 0 && html.indexOf('Latest plays') < html.indexOf('Scoring summary'));
    assert.ok(html.includes('A short run') && html.includes('A touchdown'));
  });

  it('keeps a finished game to its scoring summary', () => {
    const html = show(center(), false);
    assert.equal(html.includes('Latest plays'), false);
    assert.equal(html.includes('A short run'), false);
    assert.ok(html.includes('Scoring summary'));
  });

  it('shows plays in a scoreless game instead of saying there are none', () => {
    const html = show(center({ scoring: [] }), true);
    assert.ok(html.includes('A short run'));
    assert.equal(html.includes('No plays yet'), false);
  });

  it("doesn't repeat basketball's plays, where every basket counts as scoring", () => {
    const html = show(center(), true, 'nba');
    assert.equal(html.match(/Latest plays/g)?.length, 1);
    assert.equal(html.includes('Scoring summary'), false);
  });

  it('tells the truth about a finished game with no stats', () => {
    const html = show(center({ leaders: [] }), false);
    assert.ok(html.includes('No stats on file'));
    assert.equal(html.includes('once the game starts'), false);
  });
});
