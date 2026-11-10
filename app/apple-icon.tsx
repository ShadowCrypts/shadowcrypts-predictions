import { ImageResponse } from 'next/og';
import { brandMarkDataUri } from '../lib/brand';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** iOS rounds the corners itself, so the icon is full-bleed. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={brandMarkDataUri(180, { rounded: false })} width={180} height={180} alt="" />
    ),
    size
  );
}
