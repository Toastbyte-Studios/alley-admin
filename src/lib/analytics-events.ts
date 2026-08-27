/**
 * The analytics event vocabulary for alleyadmin.app.
 *
 * Deliberately smaller than the toastbyte.studio list. This is a single
 * statically rendered page with one conversion, so there are only three
 * questions worth asking: how many people start the waitlist form versus
 * finish it, where the outbound clicks go, and whether anyone uses the theme
 * toggle.
 *
 * Note what is NOT here: `page_view`. toastbyte.studio fires it by hand
 * because it is a hash-routed SPA where navigation never reloads the
 * document. This site has one route and one document load, so Zaraz's
 * automatic Pageviews action already covers it — adding a manual one would
 * double-count every visit.
 *
 * Keep this small. Every name here is a commitment to fire it from somewhere
 * and to see it in reports.
 */
export const ANALYTICS_EVENTS = {
  /** The waitlist form was submitted and passed the browser's own validation. */
  waitlistSignupStarted: 'waitlist_signup_started',

  /**
   * The registration Worker accepted the address (HTTP 201).
   *
   * There is no separate `duplicate` event, unlike toastbyte.studio. This
   * Worker inserts with `INSERT OR IGNORE` and returns 201 either way, so a
   * repeat signup is indistinguishable from a new one at the client. Adding
   * the event would mean changing the Worker's response contract first.
   */
  waitlistSignupSucceeded: 'waitlist_signup_succeeded',

  /**
   * Anything else: an invalid address (400), a server error (500), or the
   * request never completing. The `reason` param carries which.
   */
  waitlistSignupFailed: 'waitlist_signup_failed',

  /**
   * An outbound click to an external destination.
   *
   * Explicit rather than inherited: GA4's enhanced-measurement outbound-click
   * tracking ships with the gtag.js snippet, and Zaraz does not provide those
   * automatic events. Nothing captures this unless we fire it ourselves.
   */
  outboundLinkClicked: 'outbound_link_clicked',

  /** The light/dark toggle was clicked. The `theme` param is the new value. */
  themeToggled: 'theme_toggled',
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
