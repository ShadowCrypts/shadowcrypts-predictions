// The messages people sent with the site's feedback form, newest first, from .cache/feedback/.
//
//   npm run feedback               the last 30 days
//   npm run feedback -- --days=90  a longer stretch
//   npm run feedback -- --all      everything kept
//
// Times are US Eastern. To delete a message, remove its line from that month's .jsonl file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LABELS = { idea: 'Idea', bug: 'Something’s broken', data: 'A number looks wrong', other: 'Something else' };
const all = process.argv.includes('--all');
const days = Math.max(1, Number(process.argv.find((a) => a.startsWith('--days='))?.slice(7)) || 30);
const since = all ? 0 : Date.now() - days * 86_400_000;
const dir = path.join(process.cwd(), '.cache', 'feedback');

const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)) : [];
const entries = files
  .flatMap((f) =>
    readFileSync(path.join(dir, f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      })
  )
  .filter((e) => Date.parse(e.at) >= since)
  .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

const span = all ? 'ever' : `in the last ${days} days`;
if (!entries.length) {
  console.log(`No feedback ${span} yet. It shows up here as people send it from the site's Feedback button.`);
  process.exit(0);
}

const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const wrap = (text, width = 88) =>
  text.split('\n').flatMap((paragraph) => {
    const lines = [];
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    return lines;
  });

console.log(`${entries.length} message${entries.length === 1 ? '' : 's'} ${span}, newest first (times US Eastern):\n`);
for (const e of entries) {
  console.log(`— ${when.format(new Date(e.at))} · ${LABELS[e.kind] ?? e.kind}${e.page ? ` · from ${e.page}` : ''}`);
  for (const line of wrap(e.message)) console.log(`    ${line}`);
  if (e.contact) console.log(`    Reply to: ${e.contact}`);
  console.log('');
}
