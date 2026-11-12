// Feedback from the site's form (/feedback): the kinds, labels and limits the form and the server share.
// The server's checks are in lib/feedbackRead.ts, and lib/feedbackStore.ts keeps what passes.

export const FEEDBACK_KINDS = ['idea', 'bug', 'data', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_LABELS: Record<FeedbackKind, string> = { idea: 'An idea', bug: 'Something’s broken', data: 'A number looks wrong', other: 'Something else' };

export const FEEDBACK_LIMITS = {
  /** Longest message, in characters. */
  message: 2_000,
  /** Shortest message worth keeping. */
  minMessage: 3,
  contact: 120,
  /** Largest request body read. */
  bytes: 8_192,
  /** Messages one address can send in an hour (counted in memory only). */
  perHour: 5,
  /** A form sent sooner than this after it opened was filled in by a program. */
  minMs: 1_500,
  /** Past this many bytes of feedback in a month, the box is full until the next. */
  monthBytes: 2_000_000
};

/** One message as kept. No address or anything else about the sender, beyond a way to reach them if they gave one. */
export type FeedbackEntry = { at: string; kind: FeedbackKind; message: string; page: string | null; contact: string | null };
