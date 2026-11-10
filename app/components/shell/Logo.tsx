import Link from 'next/link';
import { brandMarkDataUri } from '../../../lib/brand';

export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={brandMarkDataUri(size)} width={size} height={size} alt="" aria-hidden className={`shrink-0 ${className}`} />;
}

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5 rounded-lg" aria-label="ShadowCrypts Predictions home">
      <LogoMark className="transition duration-300 group-hover:scale-105 group-hover:drop-shadow-[0_0_10px_rgba(103,232,249,0.45)]" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[17px] font-semibold tracking-tight text-ink">ShadowCrypts</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">Predictions</span>
      </span>
    </Link>
  );
}
