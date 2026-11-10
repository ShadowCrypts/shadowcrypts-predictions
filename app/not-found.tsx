import Link from 'next/link';
import { Signature } from './components/shell/Signature';

/** Where people most often meant to go, offered from a dead end. */
const ELSEWHERE = [
  ['/live', 'Live now'],
  ['/props', 'Player props'],
  ['/results', 'Last night’s results'],
  ['/record', 'Track record']
] as const;

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <Signature size="large" className="mx-auto mb-5 h-auto w-full max-w-72 rounded-xl ring-1 ring-line" />
      <p className="eyebrow">404</p>
      <h1 className="mt-2 font-display text-xl font-semibold text-ink">Nothing in this crypt</h1>
      <p className="mt-2 text-sm text-ink-2">That page doesn&apos;t exist, or the game or team is outside the seasons the model tracks.</p>
      <Link href="/" className="mt-6 inline-block rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110">
        Back to today&apos;s board
      </Link>
      <nav className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Elsewhere">
        {ELSEWHERE.map(([href, label]) => (
          <Link key={href} href={href} className="chip chip-idle">
            {label}
          </Link>
        ))}
      </nav>
      <p className="mt-4 text-xs text-ink-3">
        Looking for a team or player? Press <kbd className="rounded border border-line px-1">Ctrl</kbd> <kbd className="rounded border border-line px-1">K</kbd> or use
        the search in the header.
      </p>
    </div>
  );
}
