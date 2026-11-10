# Contributing

Issues and pull requests are welcome.

## Before opening a pull request

```bash
npm install
npm run verify          # type check, lint and unit tests
npm run build && npm run start
npm run smoke           # in a second terminal: end-to-end checks against the running server
```

`npm run datacheck` (the numbers against ESPN's feeds) and `npm run audit` (Lighthouse on phone and desktop) are worth running for anything that changes data or pages. [docs/OPERATIONS.md](docs/OPERATIONS.md) has every script.

## House rules

- **Numbers come from something anyone can re-run.** A claim on the site or in the docs about accuracy comes from a backtest script (`npm run backtest -- --…`) or a check, measured on games the model didn't learn from, with the date. Report it whichever way it went: several things were tried and rejected, and the docs say so.
- **The betting market is the bar.** Closing lines beat every rating model here, so a modeling change shows its gain against the line, not just against the old model.
- **Not betting advice.** Keep the site's wording to insight and entertainment.
- **Accessibility and security stay where they are**: AA contrast in both themes, nothing new outside the Content Security Policy, and new pages added to `lib/routes.ts` (a test checks it).
- **No artwork.** The ShadowCrypt artwork, logo and names aren't covered by the code's license (see [ARTWORK.md](ARTWORK.md)), so pull requests don't add to or change them.

## Security problems

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
