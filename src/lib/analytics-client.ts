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
        setAll?: (value: boolean) => void;
      };
      set?: (key: string, value: unknown) => void;
    };
  }
}

// The consent cookie is deliberately NOT HttpOnly: a banner has to read it to
// know whether to show, and write it when clicked. It holds one enum value and
// never an identifier.

function readConsentCookie(): ConsentValue | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const prefix = `${ANALYTICS_CONSENT_COOKIE}=`;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return entry
    ? parseConsentValue(decodeURIComponent(entry.slice(prefix.length)))
    : null;
}

function writeConsentCookie(value: ConsentValue) {
  // Secure is conditional so the cookie still sets on http://localhost during
  // `astro dev`; production is HTTPS-only and always gets it.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${ANALYTICS_CONSENT_COOKIE}=${value}; Path=/; ` +
    `Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
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
