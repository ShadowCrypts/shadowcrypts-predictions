import { ImageResponse } from 'next/og';
import { brandMarkDataUri } from '../../../lib/brand';

/** PNG app icons for the web manifest: /brand-icon/192, /brand-icon/512, and ?maskable=1 for Android's adaptive shapes. */
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === '192' ? 192 : 512;
  const maskable = new URL(request.url).searchParams.has('maskable');
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={brandMarkDataUri(size, maskable ? { bleed: true } : { rounded: false })} width={size} height={size} alt="" />
    ),
    // The manifest links these with a ?v= fingerprint of the mark, so a long cache is safe.
    { width: size, height: size, headers: { 'cache-control': 'public, max-age=86400' } }
  );
}
