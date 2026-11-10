import type { Instrumentation } from 'next';
import { log, pathOnly } from './lib/log';

/** At server start: the background alert scan (never during a build, and only on the Node.js runtime). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startAlerts } = await import('./lib/push-server');
  startAlerts();
}

/**
 * Every server error, as one structured log line: what failed, where, and the
 * digest the error page shows the visitor (so a report can be matched to its
 * log). No headers or query strings.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const error = err instanceof Error ? err : new Error(String(err));
  log('error', 'request-error', {
    message: error.message.slice(0, 500),
    digest: typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : undefined,
    method: request.method,
    path: pathOnly(request.path),
    route: context.routePath,
    kind: context.routeType,
    stack: error.stack?.split('\n').slice(1, 6).map((s) => s.trim())
  });
};
