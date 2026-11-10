import { readCapped } from '../../../lib/http';
import { log, pathOnly } from '../../../lib/log';

export const dynamic = 'force-dynamic';

/** Reports bigger than this are refused unread: a real one is a few hundred bytes. */
const MAX_BYTES = 16_384;
/** A batch from the Reporting API can hold several; more than this is noise. */
const MAX_REPORTS = 10;

type Violation = { page: string | null; directive: string | null; blocked: string | null; sample: string | null };

/** Both report formats: the classic `{ "csp-report": … }` and the Reporting API's list of `{ type, body }`. */
function violations(data: unknown): Violation[] {
  const pick = (r: Record<string, unknown>): Violation => ({
    page: pathOnly(String(r['document-uri'] ?? r.documentURL ?? '')),
    directive: String(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? '').slice(0, 60) || null,
    blocked: pathOnly(String(r['blocked-uri'] ?? r.blockedURL ?? '')),
    sample: String(r['script-sample'] ?? r.sample ?? '').slice(0, 80) || null
  });
  if (Array.isArray(data)) {
    return data
      .filter((r) => r && typeof r === 'object' && (r as { type?: unknown }).type === 'csp-violation')
      .slice(0, MAX_REPORTS)
      .map((r) => pick(((r as { body?: unknown }).body ?? {}) as Record<string, unknown>));
  }
  const report = data && typeof data === 'object' ? (data as Record<string, unknown>)['csp-report'] : null;
  return report && typeof report === 'object' ? [pick(report as Record<string, unknown>)] : [];
}

/**
 * POST /api/csp-report: where browsers report anything the Content Security
 * Policy blocked, logged as one line each (page and blocked address without
 * query strings). A blocked script on a page is either a bug or an attack.
 */
export async function POST(request: Request) {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/(csp-report|reports\+json|json)\b/.test(type)) return new Response(null, { status: 415 });
  const text = await readCapped(request, MAX_BYTES);
  if (text === null) return new Response(null, { status: 413 });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  for (const v of violations(data)) log('warn', 'csp-violation', v);
  return new Response(null, { status: 204 });
}
