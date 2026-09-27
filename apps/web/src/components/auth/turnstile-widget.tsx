'use client';

import Script from 'next/script';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; action: string }) => string;
      reset: (widgetId: string) => void;
    };
    onTurnstileReady?: (() => void) | undefined;
  }
}

/**
 * The bot-check widget, rendered by hand: a token is accepted once by Cloudflare, so after a
 * failed attempt (`attempt` changes) the widget is reset for a fresh one, and it survives a
 * client-side navigation back to the screen. `action` names the form, and the server refuses an
 * answer given for another form (AUDIT M37).
 */
export function TurnstileWidget({
  siteKey,
  action,
  attempt,
}: {
  siteKey: string;
  action: string;
  attempt: unknown;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const render = () => {
      if (container.current === null || widgetId.current !== undefined) return;
      widgetId.current = window.turnstile?.render(container.current, { sitekey: siteKey, action });
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
      />
      <div ref={container} />
    </>
  );
}
