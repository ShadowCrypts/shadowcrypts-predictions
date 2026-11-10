'use client';

/**
 * The last line: an error in the root layout itself, where the normal error
 * page can't render. Self-contained (its own document, no theme or fonts).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#08070e', color: '#f5f3fc', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: '#bab5ce', fontSize: 14, lineHeight: 1.5 }}>The page couldn&apos;t load. It&apos;s usually brief; try again in a moment.</p>
          {error.digest && <p style={{ color: '#928caa', fontSize: 12 }}>Reference: {error.digest}</p>}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 12, border: 0, borderRadius: 12, padding: '10px 16px', background: '#7c3aed', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
