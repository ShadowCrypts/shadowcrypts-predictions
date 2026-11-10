import Image from 'next/image';

export function TeamLogo({ src, abbr, size = 28, eager = false }: { src: string | null; abbr: string; size?: number; /** Top of the page: load without waiting for layout. */ eager?: boolean }) {
  if (!src) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-raised text-[10px] font-semibold text-ink-2"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {abbr}
      </span>
    );
  }
  // Decorative: the team name always sits next to the logo.
  return <Image src={src} alt="" width={size} height={size} loading={eager ? 'eager' : 'lazy'} className="shrink-0 object-contain" style={{ width: size, height: size }} />;
}
