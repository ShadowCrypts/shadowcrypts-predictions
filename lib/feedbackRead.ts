// The server's checks on a feedback message, field by field. Pure, so the rules are tested on their own.

import { FEEDBACK_KINDS, FEEDBACK_LIMITS, FeedbackEntry, FeedbackKind } from './feedback';
import { isKnownPage } from './routes';

export type FeedbackRead = { entry: FeedbackEntry } | { trap: true } | { error: string };

/** Characters that control a terminal or flip text direction, which have no place in a note read later in one. */
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

/** Text kept to printable characters: line breaks stay (at most one blank line in a row), tabs become spaces. */
function cleanMessage(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROLS, '')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const oneLine = (text: string, max: number) => text.replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const tooLong = () => `Please keep it under ${FEEDBACK_LIMITS.message.toLocaleString('en-US')} characters.`;

/** The page the form was opened from: a path of the site's own pages (no query string), or null. */
export function feedbackPage(from: unknown) {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.length > 200) return null;
  const path = from.split(/[?#]/)[0];
  return isKnownPage(path) && !/^\/(api|_next|__next|\.well-known)(\/|$)/.test(path) ? path : null;
}

/**
 * A feedback request checked: the entry to keep, `trap` when the hidden field a person never sees was filled
 * (a program: told it worked, nothing kept), or what's wrong, in words for the form to show.
 */
export function readFeedback(body: unknown, now = new Date()): FeedbackRead {
  if (!body || typeof body !== 'object') return { error: 'That didn’t come through right. Try again.' };
  const b = body as Record<string, unknown>;
  if (typeof b.website === 'string' && b.website.trim()) return { trap: true };
  if (typeof b.elapsedMs !== 'number' || !Number.isFinite(b.elapsedMs) || b.elapsedMs < FEEDBACK_LIMITS.minMs) {
    return { error: 'That was quick. Give it a second and send it again.' };
  }
  const raw = typeof b.message === 'string' ? b.message : '';
  if (raw.length > FEEDBACK_LIMITS.message * 2) return { error: tooLong() };
  const message = cleanMessage(raw);
  if (message.length < FEEDBACK_LIMITS.minMessage) return { error: 'Write a few words first.' };
  if (message.length > FEEDBACK_LIMITS.message) return { error: tooLong() };
  const kind: FeedbackKind = (FEEDBACK_KINDS as readonly unknown[]).includes(b.kind) ? (b.kind as FeedbackKind) : 'other';
  const contact = typeof b.contact === 'string' ? oneLine(b.contact, FEEDBACK_LIMITS.contact) : '';
  return { entry: { at: now.toISOString(), kind, message, page: feedbackPage(b.page), contact: contact || null } };
}
