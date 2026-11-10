import { promises as fs } from 'fs';
import path from 'path';

type Entry<T> = { value: T; fetchedAt: number; final: boolean };

type CacheOptions<T> = {
  /** How long a non-final entry stays fresh. */
  ttlMs: number;
  /** Final entries never expire (for example, a month whose games are all over). */
  isFinal?: (value: T) => boolean;
  /** Persist to disk so restarts don't refetch history. */
  persist?: boolean;
  /** Serve an expired in-memory copy right away and rebuild in the background. */
  staleWhileRevalidate?: boolean;
};

const CACHE_DIR = path.join(process.cwd(), '.cache');

// Kept on the process, not the module: Next.js can load this file more than once in one server (the pages,
// and instrumentation's background alerts), and every copy should share one set of models and caches.
const shared = globalThis as typeof globalThis & {
  __scCache?: { memory: Map<string, Entry<unknown>>; inflight: Map<string, Promise<unknown>>; stores: Map<string, unknown> };
};
shared.__scCache ??= { memory: new Map(), inflight: new Map(), stores: new Map() };
const { memory, inflight } = shared.__scCache;

function fileFor(key: string) {
  return path.join(CACHE_DIR, `${key.replace(/[^a-z0-9._-]+/gi, '_')}.json`);
}

async function readDisk<T>(key: string): Promise<Entry<T> | null> {
  try {
    return JSON.parse(await fs.readFile(fileFor(key), 'utf8')) as Entry<T>;
  } catch {
    return null;
  }
}

let writes = 0;

/** Written whole to a temporary file, then renamed over the old one, so a reader never sees half a file. `secret` files are readable by the server's own user only. */
async function writeDisk<T>(key: string, entry: Entry<T>, secret = false) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = fileFor(key);
    // Unique per write, so two writes of the same file at once can't trip over each other's temporary copy.
    const tmp = `${file}.${process.pid}.${(writes += 1)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry), secret ? { mode: 0o600 } : undefined);
    await fs.rename(tmp, file);
  } catch {
    // A read-only filesystem only costs us the persistence, not correctness.
  }
}

const { stores } = shared.__scCache;

/** A persistent key/value file that callers grow incrementally (no TTL). */
export async function readStore<T>(key: string): Promise<T | null> {
  if (stores.has(key)) return stores.get(key) as T;
  const entry = await readDisk<T>(key);
  if (entry) stores.set(key, entry.value);
  return entry?.value ?? null;
}

export async function writeStore<T>(key: string, value: T, { secret = false }: { secret?: boolean } = {}) {
  stores.set(key, value);
  await writeDisk(key, { value, fetchedAt: Date.now(), final: true }, secret);
}

function isFresh(entry: Entry<unknown>, ttlMs: number) {
  return entry.final || Date.now() - entry.fetchedAt < ttlMs;
}

/**
 * Memory → disk → loader, with in-flight dedupe. If the loader fails and we
 * hold any stale copy, the stale copy is served instead of an error.
 */
export async function cached<T>(key: string, options: CacheOptions<T>, loader: () => Promise<T>): Promise<T> {
  const hit = memory.get(key) as Entry<T> | undefined;
  if (hit && isFresh(hit, options.ttlMs)) return hit.value;

  const pending = inflight.get(key);
  if (hit && options.staleWhileRevalidate) {
    // Nobody waits on a rebuild: the expired copy goes out now and the next request gets the new one.
    if (!pending) cached(key, { ...options, staleWhileRevalidate: false }, loader).catch(() => undefined);
    return hit.value;
  }
  if (pending) return pending as Promise<T>;

  const run = (async () => {
    let stale = hit;
    if (options.persist) {
      const disk = await readDisk<T>(key);
      if (disk) {
        if (isFresh(disk, options.ttlMs)) {
          memory.set(key, disk);
          return disk.value;
        }
        stale = disk;
      }
    }

    try {
      const value = await loader();
      const entry: Entry<T> = { value, fetchedAt: Date.now(), final: options.isFinal?.(value) ?? false };
      memory.set(key, entry);
      if (options.persist) await writeDisk(key, entry);
      return value;
    } catch (error) {
      if (stale) return stale.value;
      throw error;
    }
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/** Caps concurrent work so a cold start doesn't open dozens of sockets at once. */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}
