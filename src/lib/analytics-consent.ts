import type { AnalyticsEventName } from './analytics-events';

/**
 * Shared consent vocabulary for the browser and for server-side code.
 *
 * Ported from toastbyte.studio. Consent lives in a cookie rather than
 * localStorage so that server-side code can read the same value the browser
 * wrote — otherwise a visitor could decline and still have every
 * server-delivered event reach GA4.
 *
 * The Pages Function at `functions/api/analytics/event.ts` duplicates the
 * cookie name and the parse rule rather than importing them. Pages Functions
 * are bundled separately from the Astro build and cannot import from `src/`,
 * and `isAnalyticsConsentRequired` below reads `import.meta.env`, which does
 * not exist in the Workers runtime. Keep the two in sync by hand.
 */

export const ANALYTICS_CONSENT_COOKIE = 'analytics-consent';

/** One year, the usual ceiling for a consent record before re-prompting. */
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type ConsentValue = 'granted' | 'denied';

/**
 * `null` means the visitor has not chosen yet, which is distinct from
 * 'denied'. Absent is treated as denied for tracking purposes but as
 * unanswered for banner purposes — a banner would show on null, not on
 * 'denied'.
 */
export type ConsentState = ConsentValue | 'not-required' | null;

/**
 * Vite inlines `import.meta.env.*` at build time, so this resolves to a
 * literal in the browser bundle. It is `PUBLIC_`-prefixed because Astro only
 * exposes variables with that prefix to client code.
 *
 * This is 0 today and should stay 0 until a consent banner exists. Turning it
 * on without one means no events at all, since absent consent is a decline.
 */
export function isAnalyticsConsentRequired(): boolean {
  return import.meta.env.PUBLIC_ANALYTICS_REQUIRE_CONSENT === '1';
}

export function parseConsentValue(
  raw: string | null | undefined,
): ConsentValue | null {
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

/**
 * Events delivered even when consent is absent or denied.
 *
 * EMPTY, AND IT SHOULD STAY EMPTY.
 *
 * Every event on this site originates from a browser on our own origin, where
 * the consent cookie is available to be read, so every event can and must be
 * gated. If you find yourself wanting to add something here, the honest
 * question is whether the event should fire at all.
 */
export const CONSENT_EXEMPT_EVENTS: ReadonlySet<AnalyticsEventName> = new Set();
