// How many people are arriving, and from where: the daily totals the site keeps in .cache/visits/.
//
//   npm run visits                 the last 14 days
//   npm run visits -- --days=60    a longer stretch
//
// An arrival is a person opening a page (from a link, a search, a bookmark, or reloading); moving between
// pages inside the site isn't counted, and robots and link previews never are. Days are UTC, and the last
// minute or so is still in the server's memory, not on disk yet.
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

const total = { arrivals: 0, pages: {}, from: {} };
const add = (into, from) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
};
console.log(`Arrivals, last ${files.length} day${files.length === 1 ? '' : 's'} on file (UTC):\n`);
const rows = files.map((f) => {
  const day = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  total.arrivals += day.arrivals;
  add(total.pages, day.pages);
  add(total.from, day.from);
  return [f.slice(0, 10), day.arrivals];
});
const widest = Math.max(...rows.map(([, n]) => n), 1);
for (const [date, n] of rows) console.log(`  ${date}  ${String(n).padStart(6)}  ${'#'.repeat(Math.round((n / widest) * 40))}`);

const top = (counts, n = 10) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
const share = (n) => `${Math.round((n / Math.max(1, total.arrivals)) * 100)}%`.padStart(4);
console.log(`\n  ${total.arrivals.toLocaleString()} in all\n\nWhere they landed:`);
for (const [page, n] of top(total.pages)) console.log(`  ${String(n).padStart(6)}  ${share(n)}  ${page}`);
console.log('\nWhere they came from ("direct" is a typed address, a bookmark or an app that sends no referrer):');
for (const [site, n] of top(total.from)) console.log(`  ${String(n).padStart(6)}  ${share(n)}  ${site}`);
