'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <h1 className="font-display text-xl font-semibold text-ink">Couldn&apos;t load the latest data</h1>
      <p className="mt-2 text-sm text-ink-2">
        The sports data feed didn&apos;t respond. This is usually brief. Anything already downloaded is cached, so a retry is quick.
      </p>
      {error.digest && <p className="mt-2 text-xs text-ink-3">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-6 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110">
        Try again
      </button>
    </div>
  );
}
