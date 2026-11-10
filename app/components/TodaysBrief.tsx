import { Activity, ArrowDownRight, Eye, Flame, MoveVertical, Scale, Stethoscope, Trophy } from 'lucide-react';
import Link from 'next/link';
import type { BriefItem } from '../../lib/model/brief';
import { EmptyState } from './Section';

const ICONS = { watch: Eye, stakes: Trophy, favorite: Flame, tossup: Scale, injury: Stethoscope, line: MoveVertical, hot: Activity, cold: ArrowDownRight } as const;
const TONES = {
  watch: 'text-accent',
  stakes: 'text-warn',
  favorite: 'text-accent-strong',
  tossup: 'text-accent-2',
  injury: 'text-bad',
  line: 'text-accent-2',
  hot: 'text-good',
  cold: 'text-warn'
} as const;

export function TodaysBrief({ items }: { items: BriefItem[] }) {
  if (!items.length) return <EmptyState>Nothing to report until the next games are on the schedule.</EmptyState>;
  return (
    <ul className="-mx-2">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <li key={item.kind}>
            <Link href={item.href} className="flex gap-3 rounded-xl px-2 py-2.5 transition hover:bg-raised">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-raised ring-1 ring-line ${TONES[item.kind]}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{item.title}</span>
                <span className="block text-xs text-ink-3">{item.detail}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
