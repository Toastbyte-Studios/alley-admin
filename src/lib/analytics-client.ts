import {
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_CONSENT_MAX_AGE_SECONDS,
  CONSENT_EXEMPT_EVENTS,
  isAnalyticsConsentRequired,
  parseConsentValue,
  type ConsentState,
  type ConsentValue,
} from './analytics-consent';
import { ANALYTICS_EVENTS, type AnalyticsEventName } from './analytics-events';

export type AnalyticsParams = Record<
  string,
  string | number | boolean | null | undefined
>;

declare global {
  interface Window {
    zaraz?: {
      track?: (eventName: string, params?: Record<string, unknown>) => void;
      consent?: {
        APIReady?: boolean;
        setAll?: (value: boolean) => void;
        getAll?: () => Record<string, boolean>;
        // Delivers Pageview events Zaraz withheld while consent was absent.
        // Called by ConsentBanner.astro immediately after a visitor accepts,
        // otherwise the first pageview of the session is lost.
        sendQueuedEvents?: () => void;
      };
      set?: (key: string, value: unknown) => void;
    };
  }
}

// The consent cookie is deliberately NOT HttpOnly: a banner has to read it to
// know whether to show, and write it when clicked. It holds one enum value and
// never an identifier.

/**
 * Zaraz's own record of the visitor's choice. Only the PRESENCE of one of these
 * is read, never the contents: the format is not a documented contract, and the
 * keys are per-zone random purpose IDs. `zaraz.consent.getAll()` is the
 * supported way to read the actual decision.
 *
 * The name is configurable per zone in the Zaraz dashboard under Consent.
 * `alleyadmin.app` uses `zaraz-consent`; `cf_consent` is Cloudflare's
 * documented default and is kept for the zones that have not been checked.
 * Both are tested so this file can be copied between zones unchanged — extend
 * the list rather than editing it if another zone differs again.
 */
const ZARAZ_CONSENT_COOKIES = ['zaraz-consent', 'cf_consent'];

function readConsentCookie(): ConsentValue | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const prefix = `${ANALYTICS_CONSENT_COOKIE}=`;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!entry) {
    return null;
  }

  try {
    return parseConsentValue(decodeURIComponent(entry.slice(prefix.length)));
  } catch {
    return null;
  }
}

function writeConsentCookie(value: ConsentValue) {
  // Secure is conditional so the cookie still sets on http://localhost during
  // `astro dev`; production is HTTPS-only and always gets it.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${ANALYTICS_CONSENT_COOKIE}=${value}; Path=/; ` +
    `Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function hasCookie(name: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith(`${name}=`));
}

function mayTrack(eventName: AnalyticsEventName): boolean {
  if (!isAnalyticsConsentRequired()) {
    return true;
  }
  if (CONSENT_EXEMPT_EVENTS.has(eventName)) {
    return true;
  }
  // Absent consent is a decline, never permission.
  return readConsentCookie() === 'granted';
}

export function getAnalyticsConsentRequirement(): boolean {
  return isAnalyticsConsentRequired();
}

/**
 * The visitor's recorded choice, for a consent banner to decide whether to
 * show. `null` means unanswered, which is distinct from 'denied'.
 */
export function readAnalyticsConsent(): ConsentState {
  if (!isAnalyticsConsentRequired() || typeof window === 'undefined') {
    return 'not-required';
  }
  return readConsentCookie();
}

export function setAnalyticsConsent(granted: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    writeConsentCookie(granted ? 'granted' : 'denied');
  } catch {
    // no-op
  }

  // Zaraz maintains its own consent state for the tools it loads. Without
  // this it would keep sending to GA4 regardless of the cookie above.
  try {
    window.zaraz?.consent?.setAll?.(granted);
    window.zaraz?.set?.('consent', { analytics: granted, ads: granted });
  } catch {
    // no-op
  }
}

/**
 * Copies the current Zaraz consent state into the `analytics-consent` cookie.
 *
 * Deliberately does NOT call `setAnalyticsConsent`: that writes back into
 * Zaraz via `consent.setAll`, and this runs from Zaraz's own change event.
 * Only the cookie is written here.
 *
 * Tries to identify the "Analytics" purpose by name and mirror only that value
 * into the cookie, so other granted purposes don't accidentally enable
 * analytics tracking. Falls back to "any granted purpose" if purpose metadata
 * is unavailable.
 */
function syncConsentFromZaraz() {
  const getAll = window.zaraz?.consent?.getAll;
  if (typeof getAll !== 'function') {
    return;
  }

  try {
    const all = getAll();
    const consent = window.zaraz?.consent as
      | { purposes?: Record<string, { id?: string; name?: unknown }> }
      | undefined;
    const purposes = consent?.purposes;

    const analyticsPurposeId = purposes
      ? Object.values(purposes).find((p) => {
          const name = p?.name;
          if (typeof name === 'string') return name === 'Analytics';
          if (name && typeof name === 'object') {
            return Object.values(name as Record<string, unknown>).includes(
              'Analytics',
            );
          }
          return false;
        })?.id
      : undefined;

    const granted = analyticsPurposeId
      ? Boolean(all[analyticsPurposeId])
      : Object.values(all).some(Boolean);

    writeConsentCookie(granted ? 'granted' : 'denied');
  } catch {
    // no-op
  }
}

/**
 * Backfills the cookie for a visitor who answered the modal before this bridge
 * shipped, or in a session where the cookie was cleared.
 *
 * Guarded on Zaraz having a recorded choice. Without that guard a first-time
 * visitor who has not answered yet would be written as 'denied', erasing the
 * distinction between "declined" and "not asked" that `readAnalyticsConsent`
 * exposes for a future banner.
 */
function reconcileExistingConsent() {
  if (readConsentCookie() !== null) {
    return;
  }
  if (!ZARAZ_CONSENT_COOKIES.some((name) => hasCookie(name))) {
    return;
  }
  syncConsentFromZaraz();
}

/**
 * Bridges the Zaraz consent modal to the server-side fallback.
 *
 * Zaraz gates only the tools it loads itself. `functions/api/analytics/event.ts`
 * reaches GA4 through the Measurement Protocol, outside Zaraz entirely, and can
 * only see the `analytics-consent` cookie. Without this bridge a visitor could
 * decline in the modal and still have fallback events delivered.
 *
 * Safe to call before Zaraz has loaded, and a no-op if it never does.
 */
export function initAnalyticsConsentBridge() {
  if (typeof window === 'undefined') {
    return;
  }

  // Fired every time the visitor changes their preferences.
  document.addEventListener('zarazConsentChoicesUpdated', syncConsentFromZaraz);

  // The Consent API loads asynchronously and its ready event may already have
  // fired by the time this runs, so check the flag as well as listening.
  if (window.zaraz?.consent?.APIReady) {
    reconcileExistingConsent();
  } else {
    document.addEventListener('zarazConsentAPIReady', reconcileExistingConsent);
  }
}

/**
 * Send one event to GA4.
 *
 * Zaraz is the primary path: it is enabled on this zone, serves the analytics
 * script from alleyadmin.app rather than a third-party domain, and attaches
 * the event to the visitor's real GA4 session — so geo, device, referrer and
 * session stitching all come along for free. The GA4 measurement ID lives in
 * the Zaraz dashboard configuration, not in this repository.
 *
 * The Pages Function fallback exists for the case where Zaraz has not loaded:
 * a blocked script, a slow edge, or a request that fires before Zaraz is
 * ready. It reaches GA4 through the Measurement Protocol with a
 * server-derived identifier, so those events will NOT join the same session.
 * That is a deliberate trade — a detached event is worth more than no event —
 * but it means the fallback should stay the exception, not the norm.
 */
export function trackClientEvent(
  eventName: AnalyticsEventName,
  params: AnalyticsParams = {},
) {
  if (typeof window === 'undefined' || !mayTrack(eventName)) {
    return;
  }

  if (typeof window.zaraz?.track === 'function') {
    window.zaraz.track(eventName, params);
    return;
  }

  void fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName, params }),
    // The signup outcome events can fire as the user is navigating away.
    keepalive: true,
  }).catch(() => {});
}

export { ANALYTICS_EVENTS };
