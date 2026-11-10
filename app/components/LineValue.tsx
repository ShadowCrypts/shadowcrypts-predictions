import { ArrowDown, ArrowUp } from 'lucide-react';

/** A book's line, with where it opened when it has moved since: the market's own read on news and money. */
export function LineValue({ line, openLine }: { line: number; openLine?: number | null }) {
  if (openLine === null || openLine === undefined || openLine === line) return <>{line}</>;
  const up = line > openLine;
  return (
    <span className="inline-flex flex-col items-end leading-tight" title={`Opened at ${openLine}; the book has moved it ${up ? 'up' : 'down'} since`}>
      <span>{line}</span>
      <span className="inline-flex items-center text-[10px] text-ink-3">
        {up ? <ArrowUp className="h-2.5 w-2.5" aria-hidden /> : <ArrowDown className="h-2.5 w-2.5" aria-hidden />}
        <span className="sr-only">{up ? 'up' : 'down'} </span>from {openLine}
      </span>
    </span>
  );
}
