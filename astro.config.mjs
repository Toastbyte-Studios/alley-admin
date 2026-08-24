// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * The waitlist form POSTs to the registration Worker, so its origin has to be
 * allowed by `connect-src`. It is configurable per environment, so derive the
 * origin from the same env var the client reads rather than hardcoding it.
 */
const workerOrigin = (() => {
  const raw =
    process.env.PUBLIC_WORKER_URL ??
    'https://alleyadmin-registration-worker.jshprintz.workers.dev';
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

/**
 * Cloudflare Pages injects the Web Analytics beacon into the served HTML, so
 * its host has to be allowed even though it is not referenced by our source.
 */
const cloudflareInsights = 'https://static.cloudflareinsights.com';
const cloudflareAnalytics = 'https://cloudflareinsights.com';

/** Shared fallback stack for both families. */
const SYSTEM_FALLBACKS = [
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'sans-serif',
];

// https://astro.build/config
export default defineConfig({
  site: 'https://alleyadmin.app',
  compressHTML: true,
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],

  /**
   * Fonts are downloaded at build time and served from our own origin rather
   * than linked from Google Fonts at runtime. That removes a render-blocking
   * third-party stylesheet plus two extra origins from the critical path, and
   * lets Astro emit metric-matched fallbacks so swapping in the real font no
   * longer shifts the layout.
   *
   * Note that this makes the build depend on Google Fonts being reachable; CI
   * runs a full build on every pull request, so a fetch failure surfaces there
   * rather than on a deploy.
   */
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-inter',
      weights: ['400 700'],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
      fallbacks: SYSTEM_FALLBACKS,
    },
    {
      provider: fontProviders.google(),
      name: 'Archivo',
      cssVariable: '--font-archivo',
      weights: ['600 800'],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
      fallbacks: SYSTEM_FALLBACKS,
    },
  ],

  security: {
    /**
     * Astro hashes every inline script and style it emits, so the policy can
     * stay hash-based rather than falling back to `unsafe-inline`. Anything
     * loaded from outside the origin has to be listed explicitly below.
     */
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        // `frame-ancestors` is ignored in a <meta> CSP and only logs a console
        // warning, so framing is blocked by X-Frame-Options in public/_headers.
        "img-src 'self' data:",
        "font-src 'self'",
        "manifest-src 'self'",
        `connect-src 'self'${workerOrigin ? ` ${workerOrigin}` : ''} ${cloudflareAnalytics}`,
      ],
      scriptDirective: {
        resources: ["'self'", cloudflareInsights],
      },
      styleDirective: {
        resources: ["'self'"],
      },
    },
  },

  build: {
    // The single stylesheet is small enough that inlining it beats a
    // render-blocking round trip for it on first paint.
    inlineStylesheets: 'always',
  },
  vite: {
    build: {
      cssMinify: true,
    },
  },
});
