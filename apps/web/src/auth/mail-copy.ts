import type { MailMessage } from '@shakti/domain';
import { createTranslator } from 'next-intl';
import en from '../../messages/en.json';

/** Catalogue lookup outside a request, for mail sent by the auth module. Mail is English (ADR 0014). */
export function mailTranslator() {
  return createTranslator({ locale: 'en', messages: en, namespace: 'mail' });
}

/** The notice a user gets when an Executive resets their authenticator app. It names no Executive. */
export function twoFactorResetMail(user: { email: string; name: string }): MailMessage {
  const t = mailTranslator();
  return {
    to: user.email,
    subject: t('twoFactorReset.subject'),
    text: t('twoFactorReset.body', { name: user.name }),
  };
}
