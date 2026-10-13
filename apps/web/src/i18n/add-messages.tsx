'use client';

import {
  NextIntlClientProvider,
  useLocale,
  useMessages,
  type AbstractIntlMessages,
} from 'next-intl';
import { useMemo, type ReactNode } from 'react';

/**
 * Adds message groups to the ones the provider above already sent (WEB-1). A provider of its own
 * replaces its parent's messages, so the parent's are carried over here, in the browser, instead
 * of being sent again; the time zone and the error handling come from the parent as well.
 */
export function AddMessages({
  messages,
  children,
}: {
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  const parent = useMessages();
  const locale = useLocale();
  const merged = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
  return (
    <NextIntlClientProvider locale={locale} messages={merged}>
      {children}
    </NextIntlClientProvider>
  );
}
