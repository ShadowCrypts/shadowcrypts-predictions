'use client';

import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The footer's way to the feedback form, carrying the page it was pressed on (so a "this number's wrong" says where). */
export function FeedbackButton() {
  const pathname = usePathname();
  const href = pathname && pathname !== '/feedback' ? `/feedback?from=${encodeURIComponent(pathname)}` : '/feedback';
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-line transition hover:bg-line"
    >
      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
      Send feedback
    </Link>
  );
}
