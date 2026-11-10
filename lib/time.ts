// Every league here schedules in US Eastern time, so the app groups and labels
// games in ET regardless of where the server runs.
export const TIME_ZONE = 'America/New_York';

const dateKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' });
const longDayFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric' });

/** When a server page is being rendered, for "Updated" stamps and time windows (server components render once per request). */
export const renderedAt = () => new Date();

/** YYYY-MM-DD in Eastern time. */
export function etDateKey(date: Date | string) {
  return dateKeyFormat.format(typeof date === 'string' ? new Date(date) : date);
}

/** YYYYMMDD in Eastern time, the format ESPN's `dates` parameter takes. */
export function etYmd(date: Date) {
  return etDateKey(date).replace(/-/g, '');
}

export function formatTime(iso: string) {
  return `${timeFormat.format(new Date(iso))} ET`;
}

export function formatDay(iso: string) {
  return dayFormat.format(new Date(iso));
}

export function formatLongDay(date: Date | string) {
  return longDayFormat.format(typeof date === 'string' ? new Date(date) : date);
}

export function formatShortDate(iso: string) {
  return shortDateFormat.format(new Date(iso));
}

/** A YYYY-MM-DD key moved by whole days (anchored at midday so time-zone shifts can't skip a day). */
export function shiftDateKey(dateKey: string, days: number) {
  return etDateKey(new Date(Date.parse(`${dateKey}T16:00:00Z`) + days * 86_400_000));
}

export const isDateKey = (value: string | null | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/** "Today", "Tomorrow", "Yesterday", or a short weekday label for a date key. */
export function relativeDayLabel(dateKey: string, now = new Date()) {
  const today = etDateKey(now);
  const tomorrow = etDateKey(new Date(now.getTime() + 86_400_000));
  const yesterday = etDateKey(new Date(now.getTime() - 86_400_000));
  if (dateKey === today) return 'Today';
  if (dateKey === tomorrow) return 'Tomorrow';
  if (dateKey === yesterday) return 'Yesterday';
  return formatLongDay(`${dateKey}T16:00:00Z`);
}
