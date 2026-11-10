import type { Prediction } from './index';

/** A player likely to sit (half a chance or more) who's worth this much Elo to his team counts as news when he goes out or comes back. */
const NEWS_ELO = 8;
const NEWS_MISS = 0.5;

/** The players a forecast counts as likely out, as "id|TEAM|Name", sorted. */
export function keyAbsences(p: Pick<Prediction, 'injuries' | 'game'>): string[] {
  return (['home', 'away'] as const)
    .flatMap((side) =>
      (p.injuries?.[side] ?? []).filter((i) => i.missChance >= NEWS_MISS && Math.abs(i.value) >= NEWS_ELO).map((i) => `${i.athleteId}|${p.game[side].abbr}|${i.name}`)
    )
    .sort();
}

export type Absent = { name: string; team: string };
const absent = (key: string): Absent => {
  const [, team, ...name] = key.split('|');
  return { name: name.join('|'), team };
};

/** Who went out and who came back between two absence lists (null when the older one isn't known, or nothing changed). */
export function injuryNews(before: string[] | undefined, after: string[]): { out: Absent[]; back: Absent[] } | null {
  if (!before) return null;
  const was = new Set(before.map((k) => k.split('|')[0]));
  const now = new Set(after.map((k) => k.split('|')[0]));
  const out = after.filter((k) => !was.has(k.split('|')[0])).map(absent);
  const back = before.filter((k) => !now.has(k.split('|')[0])).map(absent);
  return out.length || back.length ? { out, back } : null;
}

/** "Luka Doncic out, Anthony Davis back" */
export function newsText(news: { out: Absent[]; back: Absent[] }) {
  return [...news.out.map((a) => `${a.name} out`), ...news.back.map((a) => `${a.name} back`)].join(', ');
}
