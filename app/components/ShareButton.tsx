'use client';

import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';

/** Shares a link (this page unless `url` says otherwise) through the phone's share sheet, or copies it. */
export function ShareButton({ title, text, url: path, label = 'Share' }: { title: string; text: string; url?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = path ? new URL(path, window.location.origin).href : window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Cancelled share sheet or blocked clipboard: nothing to do.
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink"
    >
      {copied ? <Check className="h-4 w-4 text-good" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
      {copied ? 'Link copied' : label}
    </button>
  );
}
