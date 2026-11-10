import { TeamLogo } from './TeamLogo';

/** A team's logo on a soft disc of its own color. */
export function TeamBadge({ side, size }: { side: { logo: string | null; abbr: string; color: string }; size: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-white/10"
      style={{ width: size + 10, height: size + 10, background: `radial-gradient(circle at 50% 35%, ${side.color}40, ${side.color}14 70%)` }}
    >
      <TeamLogo src={side.logo} abbr={side.abbr} size={size} />
    </span>
  );
}

/** Each team's color glowing in from its own corner, and a thin edge running from one color to the other. Put content above it in a `relative` box. */
export function TeamGlow({ away, home, strength = 1 }: { away: string; home: string; strength?: number }) {
  const a = Math.round(0x22 * strength)
    .toString(16)
    .padStart(2, '0');
  return (
    <>
      <span
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(120% 80% at 0% 0%, ${away}${a}, transparent 60%), radial-gradient(120% 80% at 100% 100%, ${home}${a}, transparent 60%)` }}
        aria-hidden
      />
      <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px]" style={{ background: `linear-gradient(180deg, ${away}, ${home})` }} aria-hidden />
    </>
  );
}
