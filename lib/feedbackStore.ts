// Keeps feedback in `.cache/feedback/<YYYY-MM>.jsonl`, one message per line, for the site's owner to read
// with `npm run feedback`. Each month's file has a size cap, so a flood can't fill the disk.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FEEDBACK_LIMITS, FeedbackEntry } from './feedback';

export const feedbackDir = () => path.join(process.cwd(), '.cache', 'feedback');

/** Adds one message to its month's file: "full" once that month has reached its cap. */
export async function saveFeedback(entry: FeedbackEntry, dir = feedbackDir(), maxBytes = FEEDBACK_LIMITS.monthBytes): Promise<'saved' | 'full'> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${entry.at.slice(0, 7)}.jsonl`);
  const size = await fs
    .stat(file)
    .then((s) => s.size)
    .catch(() => 0);
  if (size >= maxBytes) return 'full';
  // Readable by the site's own user only: messages can carry a way to reach their sender.
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return 'saved';
}
