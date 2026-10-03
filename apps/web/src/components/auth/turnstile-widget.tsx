'use client';

import Script from 'next/script';
import { useEffect, useRef } from 'react';

interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  size: 'flexible';
  'error-callback': () => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
      reset: (widgetId: string) => void;
    };
    onTurnstileReady?: (() => void) | undefined;
  }
}

/**
 * The bot-check widget, rendered by hand: a token is accepted once by Cloudflare, so after a
 * failed attempt (`attempt` changes), an error, an expiry or a timeout the widget is reset for a
 * fresh one, and it survives a client-side navigation back to the screen. `action` names the
 * form, and the server refuses an answer given for another form (AUDIT M37). The space is held
 * before it renders and it fits a 320 px screen (AUDIT L35). `nonce` lets the script run under
 * the page's Content-Security-Policy.
 */
export function TurnstileWidget({
  siteKey,
  action,
  attempt,
  nonce,
}: {
  siteKey: string;
  action: string;
  attempt: unknown;
  nonce: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const reset = () => {
      if (widgetId.current !== undefined) window.turnstile?.reset(widgetId.current);
    };
    const render = () => {
      if (container.current === null || widgetId.current !== undefined) return;
      widgetId.current = window.turnstile?.render(container.current, {
        sitekey: siteKey,
        action,
        size: 'flexible',
        'error-callback': reset,
        'expired-callback': reset,
        'timeout-callback': reset,
      });
    };
    if (window.turnstile) render();
    else window.onTurnstileReady = render;
    return () => {
      if (window.onTurnstileReady === render) window.onTurnstileReady = undefined;
    };
  }, [siteKey, action]);
  useEffect(() => {
    if (widgetId.current !== undefined) window.turnstile?.reset(widgetId.current);
  }, [attempt]);
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileReady&render=explicit"
        strategy="afterInteractive"
        nonce={nonce}
      />
      {/* data-dynamic: the widget changes from visit to visit, so screenshots mask it. */}
      <div ref={container} data-dynamic className="min-h-[65px] w-full max-w-full" />
    </>
  );
}
