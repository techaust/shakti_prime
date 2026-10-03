import type { BrowserContext } from '@playwright/test';

/**
 * A stand-in for Cloudflare's Turnstile script in the browser. The real widget loads frames from
 * Cloudflare that hold a page's load event until they finish, and on a slow link they held
 * journeys past their time limits; the journeys test the BOS, not Cloudflare's frame. The stand-in
 * answers `render` with the hidden `cf-turnstile-response` field the real widget fills, and a new
 * value after `reset`. The server still checks every answer with Cloudflare (with the published
 * test secret, which accepts any answer), so the sign-in path is the real one past the browser.
 */
const STAND_IN = `(() => {
  const fields = [];
  window.turnstile = {
    render(container, options) {
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'cf-turnstile-response';
      field.value = 'e2e-' + ((options && options.action) || 'widget') + '-' + Date.now();
      container.appendChild(field);
      fields.push(field);
      return String(fields.length - 1);
    },
    reset(id) {
      const field = fields[Number(id)];
      if (field) field.value = 'e2e-again-' + Date.now();
    },
  };
  if (typeof window.onTurnstileReady === 'function') window.onTurnstileReady();
})();`;

/** Serves the stand-in in place of Cloudflare's script for every page of the context. */
export async function standInForTurnstile(context: BrowserContext): Promise<void> {
  await context.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STAND_IN }),
  );
}
