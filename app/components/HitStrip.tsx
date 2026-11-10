export type HitRate = { hits: number; n: number; marks: boolean[] };

/** A hit rate as "7/10" over a strip of those games, oldest on the left: green for over, faint for under. */
export function HitStrip({ rate }: { rate: HitRate }) {
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="text-xs text-ink-2 tabular">
        <span className="font-semibold text-ink">{rate.hits}</span>/{rate.n}
        <span className="sr-only"> games over this line</span>
      </span>
      <span className="flex gap-[2px]" aria-hidden>
        {[...rate.marks].reverse().map((over, i) => (
          <span key={i} className={`h-2.5 w-1.5 rounded-[2px] ${over ? 'bg-good' : 'bg-ink-3/30'}`} />
        ))}
      </span>
    </span>
  );
}
