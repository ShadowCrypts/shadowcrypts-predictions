/**
 * Runs the production site and the refresher together, the way the Docker
 * setup would, without Docker. Either one is restarted if it crashes, and
 * Ctrl+C stops both. Needs a production build first (`npm run build`), or use
 * `npm run prod` to build and serve in one go.
 *
 *   npm run serve              (port 3000, or set PORT)
 *
 * It listens on this computer only (127.0.0.1): `tailscale serve 3000`, a
 * Cloudflare Tunnel or a reverse proxy reach it there. To open it to every
 * device on your networks (Wi-Fi, VPNs), set HOST=0.0.0.0 on purpose.
 */
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const port = process.env.PORT || '3000';
const host = process.env.HOST || '127.0.0.1';
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

if (!existsSync(path.join(root, '.next', 'BUILD_ID'))) {
  console.error('No production build found. Run `npm run build` first, or `npm run prod` to build and serve.');
  process.exit(1);
}
if (!/^\d{1,5}$/.test(port) || !/^[A-Za-z0-9.:-]{1,253}$/.test(host)) {
  console.error('PORT must be a number and HOST an address or host name.');
  process.exit(1);
}

type Job = { name: string; args: string[]; child?: ChildProcess; restarts: number; startedAt: number };
const jobs: Job[] = [
  { name: 'web', args: [nextBin, 'start', '-p', port, '-H', host], restarts: 0, startedAt: 0 },
  // `--import tsx` rather than the tsx CLI, which would put a second process in between.
  { name: 'refresh', args: ['--import', 'tsx', path.join('scripts', 'refresh.ts')], restarts: 0, startedAt: 0 }
];
let stopping = false;

/** Prefixes each output line with the job's name so the two logs stay readable side by side. */
function relay(name: string, stream: NodeJS.ReadableStream | null, out: NodeJS.WriteStream) {
  let buffer = '';
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
}

function start(job: Job) {
  job.startedAt = Date.now();
  // `next start` has died a few times on Windows with a native crash (0xC0000409) and no message. If Node itself hits a
  // fatal error, this leaves a report to read (no environment, so no keys in it); none alongside a crash means native code.
  const reports = path.join(root, '.cache', 'crash-reports');
  mkdirSync(reports, { recursive: true });
  const diagnostics = `--report-on-fatalerror --report-exclude-env --report-directory=${JSON.stringify(reports)}`;
  const env = { ...process.env, NODE_ENV: 'production' as const, NODE_OPTIONS: [process.env.NODE_OPTIONS, diagnostics].filter(Boolean).join(' ') };
  const child = spawn(process.execPath, job.args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;
  relay(job.name, child.stdout, process.stdout);
  relay(job.name, child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    // Back off if it keeps dying straight away (port taken, broken build), up to a minute.
    const quick = Date.now() - job.startedAt < 30_000;
    job.restarts = quick ? job.restarts + 1 : 0;
    const wait = Math.min(60_000, 2_000 * 2 ** Math.min(job.restarts, 5));
    const ran = Math.round((Date.now() - job.startedAt) / 1000);
    console.error(`[${job.name}] ${new Date().toISOString()} exited (${signal ?? `code ${code}`}) after ${ran}s; restarting in ${wait / 1000}s`);
    setTimeout(() => !stopping && start(job), wait);
  });
}

/** Windows doesn't pass a kill on to a process's own children, so end the whole tree there. */
function kill(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function stop() {
  if (stopping) return;
  stopping = true;
  console.log('Stopping the site and the refresher...');
  for (const job of jobs) if (job.child) kill(job.child);
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log(
  `ShadowCrypts Predictions on http://${host === '127.0.0.1' ? 'localhost' : host}:${port}${host === '127.0.0.1' ? ' (this computer only; HOST=0.0.0.0 opens it to your networks)' : ''}, with the refresher. Ctrl+C stops both.`
);
for (const job of jobs) start(job);
