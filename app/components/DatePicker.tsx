'use client';

import { CalendarDays } from 'lucide-react';
import { useRouter } from 'next/navigation';

/** Jumps the results page to any date in the window. */
export function DatePicker({ value, min, max }: { value: string; min: string; max: string }) {
  const router = useRouter();
  return (
    <label className="chip chip-idle cursor-pointer">
      <CalendarDays className="h-4 w-4" aria-hidden />
      <span className="sr-only">Pick a date</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => e.target.value && router.push(`/results?date=${e.target.value}`)}
        className="bg-transparent text-sm text-ink [color-scheme:inherit] focus:outline-none"
      />
    </label>
  );
}
