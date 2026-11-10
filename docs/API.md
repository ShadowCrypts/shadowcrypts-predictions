# API

The JSON and CSV endpoints. The running site also documents them, with live examples, at `/data`. Back to the [README](../README.md).

`GET /api/predictions`, `/api/rankings`, `/api/record` and `/api/teams`, each optionally filtered with `?league=nfl|nba|mlb|nhl` (except teams).

- `/api/calendar?teams=nba:2,nfl:25`: an iCalendar feed of those teams' games with forecasts, which calendar apps can subscribe to.
- `/api/cards?ids=nba:401909095`: game cards for specific games.
- `/api/legs?ids=p~nba~401909095~3112335~pts~24.5~over,w~nba~401909095~7`: results for parlay legs (a player's stat against a line and side, or a team to win): pending until the game is final (with the stat so far and the clock while it's on), void when the player didn't play.
- `/api/sweat?ids=…` (same leg ids): each started game behind those legs, play by play: wall-clock time, share of regulation played, score margin and every prop leg's stat at each moment. Finished games are kept in `.cache/`; games under way are read again at most every 45 seconds.
- `/api/live`: every league's games on now, starting soon and just finished (with live win chances), and the next game when nothing's close.
- `/api/players`: every NBA, NHL and NFL player with a page (league, id, name, team, recent playing time), for search.
- `/api/games`: every game on the board not yet final, both teams and the start, for search.
- `/api/graded?league=nba`: every game the track record grades, as CSV (the forecast it's graded on, the pick, whether it won, whether a line was posted, and the locked forecast where one was logged). It adds up exactly to the record page; the record page links it.
- `/api/graded-props?league=nba`: every logged prop pick that's been graded, as CSV (the line and prices as logged, the model's view, what happened). It adds up to the forward prop record; the props page links it.
- `/api/players/next?ids=nba:3112335,nfl:3918298`: those players' next games and main lines with the chance of each over.
- `/api/health`: server status.
- `GET /api/push/key`, `POST /api/push/watch` and `POST /api/push/unwatch`: background alerts (the public key to subscribe with; a browser's push subscription and what it watches; forgetting it). For the site's own pages.
- `POST /api/csp-report`: where browsers report anything the Content Security Policy blocked (not for programs).
