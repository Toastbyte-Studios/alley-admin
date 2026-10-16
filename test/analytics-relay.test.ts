import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ALLOWED_EVENTS,
  OUTBOUND_DESTINATIONS,
  sanitizeParams,
} from '../functions/api/analytics/event.ts';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_OUTBOUND_DESTINATIONS,
} from '../src/lib/analytics-events.ts';

/** Every .astro file under src/, for checking the markup against the lists. */
function astroSources(dir = new URL('../src/', import.meta.url).pathname) {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...astroSources(path));
    else if (entry.name.endsWith('.astro'))
      out.push(readFileSync(path, 'utf8'));
  }
  return out;
}

describe('relay allowlists', () => {
  it('match the event list in src/lib/analytics-events.ts', () => {
    assert.deepEqual(
      [...ALLOWED_EVENTS].sort(),
      Object.values(ANALYTICS_EVENTS).sort(),
    );
  });

  it('match the outbound destinations', () => {
    assert.deepEqual(
      [...OUTBOUND_DESTINATIONS].sort(),
      [...ANALYTICS_OUTBOUND_DESTINATIONS].sort(),
    );
  });

  it('cover every data-outbound link on the site', () => {
    const used = astroSources().flatMap((source) =>
      [...source.matchAll(/data-outbound="([^"]+)"/g)].map((m) => m[1]),
    );
    assert.ok(used.length > 0);
    for (const destination of used) {
      assert.ok(OUTBOUND_DESTINATIONS.has(destination), destination);
    }
  });
});

describe('sanitizeParams', () => {
  it('sends the signup start and success events with no params', () => {
    assert.deepEqual(sanitizeParams('waitlist_signup_started', undefined), {});
    assert.deepEqual(
      sanitizeParams('waitlist_signup_succeeded', { email: 'a@b.co' }),
      {},
    );
  });

  it('keeps only known failure reasons', () => {
    for (const reason of [
      'invalid_email',
      'server_error',
      'network_error',
      'http_429',
    ]) {
      assert.deepEqual(sanitizeParams('waitlist_signup_failed', { reason }), {
        reason,
      });
    }
    assert.equal(
      sanitizeParams('waitlist_signup_failed', { reason: 'a@b.co' }),
      null,
    );
    assert.equal(sanitizeParams('waitlist_signup_failed', {}), null);
  });

  it('keeps a known outbound destination and drops everything else', () => {
    assert.deepEqual(
      sanitizeParams('outbound_link_clicked', {
        destination: 'toastbyte-studio',
        href: 'https://toastbyte.studio/?email=a@b.co',
      }),
      { destination: 'toastbyte-studio' },
    );
    assert.equal(
      sanitizeParams('outbound_link_clicked', { destination: 'evil.example' }),
      null,
    );
  });

  it('keeps only light and dark themes', () => {
    assert.deepEqual(sanitizeParams('theme_toggled', { theme: 'dark' }), {
      theme: 'dark',
    });
    assert.equal(
      sanitizeParams('theme_toggled', { theme: 'x'.repeat(99) }),
      null,
    );
  });

  it('never forwards a param it does not know', () => {
    const result = sanitizeParams('theme_toggled', {
      theme: 'light',
      user_email: 'a@b.co',
      extra: 1,
    });
    assert.deepEqual(result, { theme: 'light' });
  });

  it('rejects params that are not an object, and unknown events', () => {
    assert.equal(sanitizeParams('theme_toggled', ['light']), null);
    assert.equal(sanitizeParams('theme_toggled', 'light'), null);
    assert.equal(sanitizeParams('page_view', {}), null);
  });
});
