/** A chance as a small bar under its number: the brand gradient past even, muted below it. Decorative; the number says it. */
export function ChanceBar({ chance, width = 'w-14' }: { chance: number; width?: string }) {
  const p = Math.max(0, Math.min(1, chance));
  return (
    <span className={`relative mt-1 block h-1 ${width} overflow-hidden rounded-full bg-track`} aria-hidden>
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${p >= 0.5 ? 'bg-gradient-to-r from-accent to-accent-strong' : 'bg-ink-3/50'}`}
        style={{ width: `${(p * 100).toFixed(1)}%` }}
      />
      {/* Even money, for reference. */}
      <span className="absolute inset-y-0 left-1/2 w-px bg-ink/30" />
    </span>
  );
}
