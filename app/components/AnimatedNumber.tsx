'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that glides to each new value (ease-out, under a second) instead
 * of jumping, so a chance moving from 31% to 48% reads as a move. Renders the
 * real value on the server and first paint; motion is skipped for anyone who
 * prefers less.
 */
export function AnimatedNumber({ value, format, duration = 800 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let began = 0;
    const step = (t: number) => {
      if (!began) began = t;
      const k = reduce || start === value ? 1 : Math.min(1, (t - began) / duration);
      const v = start + (value - start) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(shown)}</>;
}
