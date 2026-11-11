// How many people are arriving, and from where: the daily totals the site keeps in .cache/visits/.
//
//   npm run visits                 the last 14 days
//   npm run visits -- --days=60    a longer stretch
//
// An arrival is a person opening a page (from a link, a search, a bookmark, or reloading); moving between
// pages inside the site isn't counted. Robots, scripts and link previews are a separate total, with why each
// was set aside (lib/visits.ts). Days are UTC, and the last minute or so is still in the server's memory,
// not on disk yet.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const days = Math.max(1, Number(process.argv.find((a) => a.startsWith('--days='))?.slice(7)) || 14);
const dir = path.join(process.cwd(), '.cache', 'visits');
if (!existsSync(dir)) {
  console.log('No visits counted yet: the folder fills in as people open pages on the running site.');
  process.exit(0);
}
const files = readdirSync(dir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .slice(-days);
if (!files.length) {
  console.log('No visits counted yet.');
  process.exit(0);
}

// Robots have been told apart by their headers since late on Nov 11, 2026, so the 12th (UTC) is the first
// whole day of it; before then, the ones giving a browser's name were counted with the people.
const SPLIT_FROM = '2026-11-12';
const WHY = {
  named: 'said they were a robot, a tool or a code library',
  'no-fetch-metadata': "a browser's name without the headers browsers send",
  'no-language': 'no language set, which every browser sends'
};

const total = { arrivals: 0, pages: {}, from: {} };
const robots = { arrivals: 0, pages: {}, why: {} };
const add = (into, from = {}) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
};
console.log(`People arriving, last ${files.length} day${files.length === 1 ? '' : 's'} on file (UTC):\n`);
const rows = files.map((f) => {
  const day = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  total.arrivals += day.arrivals;
  add(total.pages, day.pages);
  add(total.from, day.from);
  robots.arrivals += day.robots?.arrivals ?? 0;
  add(robots.pages, day.robots?.pages);
  add(robots.why, day.robots?.why);
  return { date: f.slice(0, 10), people: day.arrivals, robots: day.robots?.arrivals ?? 0 };
});
const widest = Math.max(...rows.map((r) => r.people), 1);
for (const { date, people, robots: r } of rows) {
  const note = date < SPLIT_FROM ? '  (robots giving a browser’s name still included)' : r ? `  (+${r.toLocaleString()} robots set aside)` : '';
  console.log(`  ${date}  ${String(people).padStart(6)}  ${'#'.repeat(Math.round((people / widest) * 40)).padEnd(40)}${note}`);
}

const top = (counts, n = 10) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
const share = (n, of) => `${Math.round((n / Math.max(1, of)) * 100)}%`.padStart(4);
console.log(`\n  ${total.arrivals.toLocaleString()} in all\n\nWhere they landed:`);
for (const [page, n] of top(total.pages)) console.log(`  ${String(n).padStart(6)}  ${share(n, total.arrivals)}  ${page}`);
console.log('\nWhere they came from ("direct" is a typed address, a bookmark or an app that sends no referrer):');
for (const [site, n] of top(total.from)) console.log(`  ${String(n).padStart(6)}  ${share(n, total.arrivals)}  ${site}`);

if (robots.arrivals) {
  console.log(`\nRobots and scripts set aside: ${robots.arrivals.toLocaleString()} page loads\n`);
  for (const [why, n] of top(robots.why)) console.log(`  ${String(n).padStart(6)}  ${share(n, robots.arrivals)}  ${WHY[why] ?? why}`);
  console.log('\n  What they opened:');
  for (const [page, n] of top(robots.pages, 6)) console.log(`  ${String(n).padStart(6)}  ${share(n, robots.arrivals)}  ${page}`);
}
