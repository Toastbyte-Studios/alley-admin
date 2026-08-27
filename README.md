# Alley Admin

**Modern, web-based bowling league management.** Rosters, digital scorekeeping, USBC-compliant
handicaps, standings, scheduling, and tournament brackets — in one browser app, on any device.

🚧 **Status: coming soon.** This repository currently holds the marketing and waitlist site at
[alleyadmin.app](https://alleyadmin.app). The league management application itself is in
development and not yet public.

---

## Why it exists

League secretaries juggle several pieces of desktop software — typically CDE's BLS, BTM, and TBRAC —
that haven't been meaningfully modernized, each with its own per-season license. Alley Admin folds
that functionality into a single cloud application: no installs, no version upgrades, no per-season
license fees.

**Planned capabilities**

- Team and roster management
- Weekly score entry and digital scorekeeping
- Automatic, USBC-compliant handicap calculation
- Real-time standings and statistics
- Schedule generation and management
- Tournament bracket creation
- Performance analytics for bowlers and teams
- Financial tracking — dues, prize funds, payouts

Built for league secretaries, bowling center managers, tournament directors, and USBC-certified
leagues that need compliant reporting.

## What's in this repository

| Path                 | What it is                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `src/`               | Astro site — landing page, feature sections, waitlist form                                    |
| `src/lib/`           | Analytics — event vocabulary, consent state, and the Zaraz tracking wrapper                   |
| `src/styles/`        | `global.css` — design tokens, light/dark themes, reset and base type                          |
| `functions/`         | Cloudflare Pages Function — Measurement Protocol fallback for analytics events                |
| `worker/`            | Cloudflare Worker that validates waitlist emails and writes them to D1, plus its `schema.sql` |
| `public/`            | Static assets, icons, `robots.txt`, `llms.txt`                                                |
| `.github/workflows/` | CI, Cloudflare Pages deploy, release tagging, version-bump check                              |

## Getting started

**Prerequisites:** Node.js >= 22.13.0 and npm.

```bash
git clone https://github.com/Toastbyte-Studios/alley-admin.git
cd alley-admin
npm install
cp .env.example .env
npm run dev
```

The dev server runs at `http://localhost:4321`. `PUBLIC_WORKER_URL` in `.env` points the waitlist
form at the registration Worker; leave the default to use the deployed one, or point it at a local
Worker (below).

### Scripts

| Command              | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | Start the dev server at `localhost:4321`        |
| `npm run build`      | Build the production site to `./dist/`          |
| `npm run preview`    | Preview the production build locally            |
| `npm run lint`       | Run ESLint (`lint:fix` to autofix)              |
| `npm run format`     | Format with Prettier (`format:check` to verify) |
| `npm run type-check` | Type-check with `tsc --noEmit`                  |
| `npm run cleanup`    | Format, lint, and type-check in one pass        |

Run `npm run cleanup` before opening a pull request.

## The registration Worker

`worker/` is a Cloudflare Worker backing the waitlist form. It accepts `POST` with a JSON body of
`{ "email": "..." }`, validates the address, and inserts it into a D1 `registrations` table
(`INSERT OR IGNORE`, so repeat signups are silently deduplicated). It responds `201` on success and
`400` on a malformed body or invalid address; all other methods get `405`. CORS is restricted to
`alleyadmin.app` plus the `ALLOWED_ORIGIN` configured per environment.

To run it locally:

```bash
cd worker
npm install
wrangler d1 create alleyadmin-registrations-dev   # copy the returned ID into wrangler.toml
wrangler d1 execute alleyadmin-registrations-dev --local --file=./schema.sql
npm run dev
```

`worker/schema.sql` creates the `registrations` table. Apply it to each database you provision —
add `--remote` instead of `--local` for the deployed copy. Without it the Worker returns `500` on
the first submission, since the table it inserts into doesn't exist yet.

`wrangler.toml` ships with placeholder `database_id` values for the `dev` and `production`
environments — replace them with the IDs returned by `wrangler d1 create` before deploying.

## Analytics

Events go to GA4 (`G-P73EZX3K69`) through **Cloudflare Zaraz**, configured on the `alleyadmin.app`
zone. That configuration lives in the Cloudflare dashboard — the measurement ID is not committed
here, and there is no gtag.js snippet in the HTML. Zaraz serves the tracking script from our own
origin and delivers to GA4 at the edge, which is why the CSP in `astro.config.mjs` needs no
third-party allowance for it.

`src/lib/` holds three modules:

| Module                 | What it is                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| `analytics-events.ts`  | The event vocabulary. Every name here must be fired from somewhere.           |
| `analytics-consent.ts` | Cookie-based consent state, readable from both the browser and server-side.   |
| `analytics-client.ts`  | `trackClientEvent()` — the consent gate plus the Zaraz call and its fallback. |

Call sites: the waitlist form (`CTASection.astro`) fires started / succeeded / failed, the footer
link fires `outbound_link_clicked`, and the theme toggle fires `theme_toggled`. There is no manual
`page_view` — this is one statically rendered route, so Zaraz's automatic Pageviews action already
covers it, and firing our own would double-count every visit.

`functions/api/analytics/event.ts` is a fallback for visitors whose browser never loaded Zaraz. It
reaches GA4 through the Measurement Protocol using a server-derived identifier, so those events do
**not** join the visitor's real session — a deliberate trade, but it means the endpoint should stay
quiet. It is same-origin only, rate-limited per isolate, and returns `ok` without delivering when
`ANALYTICS_GA4_MEASUREMENT_ID` and `ANALYTICS_GA4_API_SECRET` are unset. See `.env.example` for
where those are configured.

Consent is gated behind `PUBLIC_ANALYTICS_REQUIRE_CONSENT`, currently `1`. The Zaraz Consent
Management platform is enabled on the alleyadmin.app zone with an "Analytics" purpose assigned to
the GA4 tool, and `initAnalyticsConsentBridge` in `src/lib/analytics-client.ts` mirrors the
visitor's choice from that modal into the `analytics-consent` cookie.

## Deployment

Pushes to `master` trigger `.github/workflows/deploy.yml`, which builds the site and deploys it to
Cloudflare Pages under the `alley-admin` project. Deployment requires the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets. The Worker deploys separately via `npm run deploy` from
`worker/`.

## Contributing

Issues and pull requests are welcome. Open an issue first for anything larger than a typo, keep
commits focused, and run `npm run cleanup` before pushing. Note that
`.github/workflows/require-version-bump.yml` expects the `version` in `package.json` to be bumped on
pull requests.

## Links

- Website — [alleyadmin.app](https://alleyadmin.app) (`alleyadmin.com` redirects here)
- Studio — [toastbyte.studio](https://toastbyte.studio/)
