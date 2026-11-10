import { brandMarkSvg } from '../lib/brand';

export const contentType = 'image/svg+xml';

/** Vector favicon, generated from the shared mark so it can't drift from the header logo. */
export default function Icon() {
  return new Response(brandMarkSvg(32), { headers: { 'content-type': contentType } });
}
