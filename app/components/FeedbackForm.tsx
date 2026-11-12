'use client';

import { Check, Send } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FEEDBACK_KINDS, FEEDBACK_LABELS, FEEDBACK_LIMITS, FeedbackKind } from '../../lib/feedback';

const noop = () => () => {};

type Status = { state: 'idle' } | { state: 'sending' } | { state: 'sent' } | { state: 'error'; message: string };

const field = 'w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-accent';

/** The feedback form: sent to /api/feedback as JSON, so it needs the page's script (the button waits for it). */
export function FeedbackForm({ from }: { from: string | null }) {
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  // Hidden from people: only a program filling in every box puts anything here.
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  // False in the server's HTML, true once the page's script runs: the button waits for it.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const left = FEEDBACK_LIMITS.message - message.length;
  const sending = status.state === 'sending';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (message.trim().length < FEEDBACK_LIMITS.minMessage) {
      setStatus({ state: 'error', message: 'Write a few words first.' });
      return;
    }
    setStatus({ state: 'sending' });
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, message, contact, page: from, website, elapsedMs: Date.now() - openedAt.current })
    }).catch(() => null);
    if (response?.ok) {
      setStatus({ state: 'sent' });
      setMessage('');
      return;
    }
    const said = await response
      ?.json()
      .then((b: { error?: unknown }) => (typeof b.error === 'string' ? b.error : null))
      .catch(() => null);
    setStatus({ state: 'error', message: said ?? (response ? 'It didn’t go through. Try again in a bit.' : 'You seem to be offline. Try again once you’re connected.') });
  }

  if (status.state === 'sent') {
    return (
      // The form it replaces was taller: brought into view, so the thanks isn't left above the screen.
      <div ref={(node) => node?.scrollIntoView({ block: 'center', behavior: 'smooth' })} className="flex flex-col items-start gap-3" role="status">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-good">
          <Check className="h-4 w-4" aria-hidden />
          Thanks! Your message reached us.
        </p>
        <button
          type="button"
          onClick={() => {
            openedAt.current = Date.now();
            setStatus({ state: 'idle' });
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-line transition hover:bg-line"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4" noValidate>
      <fieldset>
        <legend className="text-xs text-ink-3">What&apos;s it about?</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FEEDBACK_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`chip ${kind === k ? 'chip-active' : 'chip-idle'}`}>
              {FEEDBACK_LABELS[k]}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="feedback-message" className="text-xs text-ink-3">
          Your message
        </label>
        <textarea
          id="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_LIMITS.message))}
          rows={6}
          required
          maxLength={FEEDBACK_LIMITS.message}
          placeholder={kind === 'data' ? 'Which number, and where? What did you expect it to be?' : kind === 'bug' ? 'What happened, and what did you expect?' : 'Tell us anything.'}
          className={`${field} mt-1 resize-y leading-relaxed`}
          aria-describedby="feedback-count"
        />
        <span id="feedback-count" className={`mt-1 block text-right text-xs tabular ${left < 100 ? 'text-bad' : 'text-ink-3'}`}>
          {left.toLocaleString('en-US')} characters left
        </span>
      </div>

      <div>
        <label htmlFor="feedback-contact" className="text-xs text-ink-3">
          How to reach you (optional)
        </label>
        <input
          id="feedback-contact"
          value={contact}
          onChange={(e) => setContact(e.target.value.slice(0, FEEDBACK_LIMITS.contact))}
          maxLength={FEEDBACK_LIMITS.contact}
          autoComplete="off"
          placeholder="Only if you'd like a reply: an email or @handle"
          className={`${field} mt-1`}
        />
      </div>

      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden>
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      {from && <p className="text-xs text-ink-3">Sent along with it: you came from {from}, so we know where to look.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!ready || sending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden />
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
        <p className="text-sm text-bad" role="alert">
          {status.state === 'error' ? status.message : ''}
        </p>
      </div>
    </form>
  );
}
