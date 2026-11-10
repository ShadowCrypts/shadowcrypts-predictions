import { ordinal } from '../../lib/format';
import { TeamLogo } from './TeamLogo';

type TapeTeam = { abbr: string; name: string; logo: string | null; color: string };

/** One side of a row: the value, its league rank (teams) or a bar length of its own (players), and a note under it. */
type MirrorSide = { value: string; rank?: number; of?: number; bar?: number; note?: string };
type MirrorRow = { id: string; label: string; left: MirrorSide; right: MirrorSide; edge: 'left' | 'right' | null };

/** The bar's length: the side's own when it has one, else how far along the league its rank sits (1 for first). */
function barLength(s: MirrorSide) {
  if (s.bar !== undefined) return s.bar;
  if (s.rank === undefined || s.of === undefined) return 0;
  return s.of < 2 ? 1 : 1 - (s.rank - 1) / (s.of - 1);
}

function Cell({ side, color, align, ahead }: { side: MirrorSide; color: string; align: 'left' | 'right'; ahead: boolean }) {
  const rank = side.rank !== undefined && (
    <span className="text-[11px] text-ink-3 tabular">
      {ordinal(side.rank)}
      <span className="sr-only"> of {side.of}</span>
    </span>
  );
  const length = barLength(side);
  // Last place still gets a sliver; a bar of its own at zero gets none.
  const drawn = side.bar !== undefined ? side.bar > 0 : side.rank !== undefined;
  return (
    <td className={`py-2.5 align-middle ${align === 'right' ? 'pr-3 text-right sm:pr-5' : 'pl-3 text-left sm:pl-5'}`}>
      <span className={`flex items-baseline gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {align === 'right' && rank}
        <span className={`whitespace-nowrap font-display text-sm tabular sm:text-base ${ahead ? 'font-semibold text-ink' : 'text-ink-2'}`}>{side.value}</span>
        {align === 'left' && rank}
      </span>
      {/* Bars grow out from the middle. */}
      <span className={`mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-raised ${align === 'right' ? 'justify-end' : ''}`} aria-hidden>
        {drawn && <span className="h-full rounded-full" style={{ width: `${Math.max(4, length * 100)}%`, background: color, opacity: ahead ? 1 : 0.5 }} />}
      </span>
      {side.note && <span className="mt-1 block text-[11px] leading-tight text-ink-3 tabular">{side.note}</span>}
    </td>
  );
}

/** Two sides' numbers in mirrored columns, the stat between them, the side ahead in bold. */
export function TaleOfTheTape({ rows, left, right, caption }: { rows: MirrorRow[]; left: TapeTeam; right: TapeTeam; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{caption ?? `${left.name} and ${right.name} compared, with each team's league rank`}</caption>
        <colgroup>
          <col />
          <col className="w-28 sm:w-44" />
          <col />
        </colgroup>
        <thead>
          <tr className="text-xs text-ink-3">
            <th scope="col" className="pb-2 pr-3 text-right font-medium sm:pr-5">
              <span className="inline-flex max-w-full items-center gap-2">
                <span className="truncate text-ink">{left.abbr}</span>
                <TeamLogo src={left.logo} abbr={left.abbr} size={22} />
              </span>
            </th>
            <th scope="col" className="pb-2 text-center font-medium">
              <span className="sr-only">Stat</span>
            </th>
            <th scope="col" className="pb-2 pl-3 text-left font-medium sm:pl-5">
              <span className="inline-flex max-w-full items-center gap-2">
                <TeamLogo src={right.logo} abbr={right.abbr} size={22} />
                <span className="truncate text-ink">{right.abbr}</span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id}>
              <Cell side={row.left} color={left.color} align="right" ahead={row.edge === 'left'} />
              <th scope="row" className="px-1 text-center text-[11px] font-medium uppercase leading-tight tracking-wider text-ink-3">
                {row.label}
              </th>
              <Cell side={row.right} color={right.color} align="left" ahead={row.edge === 'right'} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
