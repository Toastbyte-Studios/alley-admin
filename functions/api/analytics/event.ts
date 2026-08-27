/**
 * Measurement Protocol fallback for client events.
 *
 * Only reached when Zaraz has not loaded in the visitor's browser — see the
 * note on `trackClientEvent` in src/lib/analytics-client.ts. Zaraz is the
 * primary path and handles the vast majority of events, so this endpoint
 * should see very little traffic. If it starts seeing a lot, something is
 * wrong with the Zaraz configuration for the zone.
 *
 * Pages Functions are bundled separately from the Astro build and cannot
 * import from `src/`, so the event allowlist and the consent cookie name are
 * duplicated here. Keep them in sync with src/lib/analytics-events.ts and
 * src/lib/analytics-consent.ts.
 *
 * The Cloudflare `PagesFunction` helper type is deliberately not used: it
 * would pull in `@cloudflare/workers-types`, and everything this handler
 * touches (Request, Response, crypto.subtle, AbortSignal) is already in the
 * DOM lib the root tsconfig loads.
 */

interface Env {
  ANALYTICS_GA4_MEASUREMENT_ID?: string;
  ANALYTICS_GA4_API_SECRET?: string;
  ANALYTICS_REQUIRE_CONSENT?: string;
}

interface RequestContext {
  request: Request;
  env: Env;
}

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

const ALLOWED_EVENTS = new Set([
  'waitlist_signup_started',
  'waitlist_signup_succeeded',
  'waitlist_signup_failed',
  'outbound_link_clicked',
  'theme_toggled',
]);

const ANALYTICS_CONSENT_COOKIE = 'analytics-consent';

// Best-effort, per-isolate throttling. Not shared across instances and reset
// on cold start; a global limit would need KV or a Durable Object. Enough to
// stop a single client hammering the endpoint into our GA4 quota.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const rateLimitMap = new Map<string, number[]>();

/**
 * cf-connecting-ip is set by Cloudflare and cannot be spoofed by the caller.
 * The x-forwarded-for fallback takes the RIGHTMOST segment: the closest
 * trusted proxy appends its view of the peer, while anything to the left was
 * supplied by the caller and is forgeable.
 */
function getClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  const segments = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments[segments.length - 1] ?? 'unknown';
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function checkRateLimit(request: Request): Promise<boolean> {
  const key = (await sha256Hex(getClientIp(request))).slice(0, 16);
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const recent = (rateLimitMap.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitMap.set(key, recent);
    return false;
  }

  recent.push(now);
  rateLimitMap.set(key, recent);

  if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
    for (const [k, timestamps] of rateLimitMap.entries()) {
      const kept = timestamps.filter((t) => t > windowStart);
      if (kept.length === 0) rateLimitMap.delete(k);
      else rateLimitMap.set(k, kept);
    }
    while (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
      const oldest = rateLimitMap.keys().next().value;
      if (oldest === undefined) break;
      rateLimitMap.delete(oldest);
    }
  }

  return true;
}

/**
 * A stable-ish pseudonymous identifier so GA4 has something to group events
 * by. It is derived, not stored, and will not match the client ID Zaraz uses —
 * which is exactly why these events do not join the visitor's real session.
 */
async function toClientId(request: Request): Promise<string> {
  const seed = [
    getClientIp(request),
    request.headers.get('user-agent') ?? '',
    request.headers.get('accept-language') ?? '',
  ].join('|');
  const hex = await sha256Hex(seed);
  return `${hex.slice(0, 10)}.${hex.slice(10, 20)}`;
}

function readConsent(request: Request): string | null {
  const prefix = `${ANALYTICS_CONSENT_COOKIE}=`;
  const entry = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) return null;
  let value: string;
  try {
    value = decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
  return value === 'granted' || value === 'denied' ? value : null;
}

function json(body: unknown, status: number, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

export const onRequestPost = async ({
  request,
  env,
}: RequestContext): Promise<Response> => {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json.' }, 415);
  }

  // Same-origin only. This endpoint holds an API secret; without the check it
  // would be an open relay into our GA4 property.
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ error: 'Origin not allowed.' }, 403);
  }

  // Checked before the rate-limit budget is spent, so a visitor who declined
  // is not also throttled.
  if (
    env.ANALYTICS_REQUIRE_CONSENT === '1' &&
    readConsent(request) !== 'granted'
  ) {
    return json({ error: 'Analytics consent not granted.' }, 403);
  }

  if (!(await checkRateLimit(request))) {
    return json({ error: 'Too many requests.' }, 429, { 'Retry-After': '60' });
  }

  const body = (await request.json().catch(() => null)) as {
    eventName?: string;
    params?: Record<string, unknown>;
  } | null;

  if (!body?.eventName || !ALLOWED_EVENTS.has(body.eventName)) {
    return json({ error: 'Invalid analytics event name.' }, 400);
  }

  const measurementId = env.ANALYTICS_GA4_MEASUREMENT_ID?.trim();
  const apiSecret = env.ANALYTICS_GA4_API_SECRET?.trim();
  if (!measurementId || !apiSecret) {
    // Not an error the caller can act on, and not worth surfacing as one.
    return json({ ok: true, delivered: false }, 200);
  }

  // Drop anything that is not a primitive, and cap the count. GA4 rejects the
  // whole payload for a malformed param rather than skipping it.
  const params = Object.fromEntries(
    Object.entries(body.params ?? {})
      .filter(
        ([, v]) =>
          typeof v === 'string' ||
          typeof v === 'number' ||
          typeof v === 'boolean',
      )
      .map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : v])
      .slice(0, 24),
  );

  try {
    await fetch(
      `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
          client_id: await toClientId(request),
          non_personalized_ads: true,
          events: [
            {
              name: body.eventName,
              params: { ...params, engagement_time_msec: 1 },
            },
          ],
        }),
      },
    );
  } catch {
    // Analytics delivery must never surface as an error to the page.
  }

  return json({ ok: true }, 200);
};
