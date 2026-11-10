/** Rating trend: muted line, an end-dot on the current value (the brand accent, or a team's color). */
export function Sparkline({ values, width = 96, height = 28, label, color }: { values: number[]; width?: number; height?: number; label: string; color?: string }) {
  if (values.length < 2) return <span className="text-xs text-ink-3">—</span>;
  const pad = 5;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      <path d={d} fill="none" stroke={color ?? 'var(--text-muted)'} strokeOpacity={color ? 0.75 : 1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r={4} fill={color ?? 'var(--series-1)'} stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}
