import Link from 'next/link';

const SPORTS = [
  { id: 'nfl', href: '/nfl/fantasy', label: 'Football' },
  { id: 'nba', href: '/nba/fantasy', label: 'Basketball' }
] as const;

/** Football or basketball, at the top of each fantasy page. */
export function FantasySportSwitch({ current }: { current: 'nfl' | 'nba' }) {
  return (
    <nav aria-label="Fantasy sport" className="flex gap-1.5">
      {SPORTS.map((s) => (
        <Link key={s.id} href={s.href} aria-current={s.id === current ? 'page' : undefined} className={`chip ${s.id === current ? 'chip-active' : 'chip-idle'}`}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
