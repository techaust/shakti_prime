'use client';

import Script from 'next/script';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, type RefObject } from 'react';
import { signIn, type FormState } from '../../actions/auth';
import { Button, Field, FormError, TextInput } from '../form';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string }) => string;
      reset: (widgetId: string) => void;
    };
    onTurnstileReady?: (() => void) | undefined;
  }
}

/**
 * The bot-check widget is rendered by hand: a token is accepted once by Cloudflare, so after a
 * failed attempt the widget is reset for a fresh one, and the widget survives a client-side
 * navigation back to this screen.
 */
function useTurnstile(siteKey: string, attempt: unknown): RefObject<HTMLDivElement | null> {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const render = () => {
      if (container.current === null || widgetId.current !== undefined) return;
      widgetId.current = window.turnstile?.render(container.current, { sitekey: siteKey });
    };
    if (window.turnstile) render();
    else window.onTurnstileReady = render;
    return () => {
      if (window.onTurnstileReady === render) window.onTurnstileReady = undefined;
    };
  }, [siteKey]);
  useEffect(() => {
    if (widgetId.current !== undefined) window.turnstile?.reset(widgetId.current);
  }, [attempt]);
  return container;
}

export function SignInForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const t = useTranslations('auth.signIn');
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  const widget = useTurnstile(turnstileSiteKey, state);
  const invalid = state.error !== undefined;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t('email')} id="email">
        <TextInput
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          invalid={invalid}
          required
        />
      </Field>
      <Field label={t('password')} id="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          invalid={invalid}
          required
        />
      </Field>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileReady&render=explicit"
        strategy="afterInteractive"
      />
      <div ref={widget} />
      <FormError errorKey={state.error} />
      <Button type="submit" pending={pending}>
        {pending ? t('working') : t('submit')}
      </Button>
    </form>
  );
}
