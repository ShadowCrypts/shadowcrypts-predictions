'use client';

// Celebrations: a burst of confetti drawn on a throwaway canvas over the page,
// in the theme's colors. Nothing happens for anyone who prefers less motion.

type Piece = { x: number; y: number; vx: number; vy: number; turn: number; spin: number; w: number; h: number; color: string };

const reduced = () => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function palette() {
  const css = getComputedStyle(document.documentElement);
  return ['--accent', '--accent-2', '--good', '--warn', '--accent-strong'].map((name) => `rgb(${css.getPropertyValue(name).trim() || '139 92 246'})`);
}

/**
 * Confetti from a point on screen (viewport pixels), flying up and out, then
 * falling and fading. `count` sets how big the moment is.
 */
export function confetti({ x = window.innerWidth / 2, y = window.innerHeight / 3, count = 140, spread = 1 }: { x?: number; y?: number; count?: number; spread?: number } = {}) {
  // A tab in the background doesn't draw frames: nobody would see it.
  if (reduced() || document.visibilityState !== 'visible') return;
  const canvas = document.createElement('canvas');
  // Gone in a few seconds whatever happens to the frames.
  window.setTimeout(() => canvas.remove(), 4_000);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '100' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);
  const colors = palette();
  const pieces: Piece[] = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9 * spread;
    const speed = 6 + Math.random() * 9;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      turn: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      w: 5 + Math.random() * 5,
      h: 8 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)]
    };
  });
  const frames = 110;
  let frame = 0;
  const step = () => {
    frame += 1;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalAlpha = frame > frames - 35 ? Math.max(0, (frames - frame) / 35) : 1;
    for (const p of pieces) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.turn += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.turn);
      ctx.fillStyle = p.color;
      // Flutter: the width shrinks and grows as the piece turns.
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w * Math.abs(Math.cos(p.turn * 2)), p.h);
      ctx.restore();
    }
    if (frame < frames) requestAnimationFrame(step);
    else canvas.remove();
  };
  requestAnimationFrame(step);
}

/** Confetti from the middle of an element. */
export function confettiFrom(element: Element | null, count = 50) {
  if (!element) return confetti({ count });
  const r = element.getBoundingClientRect();
  confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count, spread: 0.7 });
}
