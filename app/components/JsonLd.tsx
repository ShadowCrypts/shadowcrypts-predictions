import { headers } from 'next/headers';

/**
 * Structured data for search engines (schema.org JSON-LD). `<` is escaped so
 * no value, team names included, can close the script element early, and it
 * carries the page's nonce like every other script.
 */
export async function JsonLd({ data }: { data: Record<string, unknown> }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
