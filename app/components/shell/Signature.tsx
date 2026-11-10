import Image from 'next/image';

/** How the signature is described wherever it appears, the proxy's own 404 page included. */
export const SIGNATURE_ALT = 'ShadowCrypt signature: a hooded figure with glowing eyes, drawn in purple text characters';

const SIZES = { small: { src: '/signature-360.webp', width: 360, height: 310 }, large: { src: '/signature-720.webp', width: 720, height: 619 } };

/** The owner's mark. Plain files from `public/`: already the right size, so nothing resizes them. */
export function Signature({ size = 'small', className }: { size?: keyof typeof SIZES; className?: string }) {
  return <Image {...SIZES[size]} alt={SIGNATURE_ALT} unoptimized className={className} />;
}
