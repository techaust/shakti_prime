import { useState } from 'react';
import { useSession, useSessionState } from '../auth/session-context';
import { Body, Button, Screen } from '../components/ui';
import { appVersion } from '../config';
import { t } from '../i18n';

/** Who is signed in, the app's version, and signing this phone out. */
export function SettingsScreen() {
  const session = useSession();
  const state = useSessionState();
  const [pending, setPending] = useState(false);
  const person = state.status === 'ready' ? state.person : null;
  return (
    <Screen title={t('settings.title')}>
      {person === null ? null : <Body>{t('settings.signedInAs', { name: person.name })}</Body>}
      {person === null || person.email === '' ? null : <Body muted>{person.email}</Body>}
      <Body muted>{t('settings.version', { version: appVersion() })}</Body>
      <Body muted>{t('settings.signOutConfirm')}</Body>
      <Button
        variant="secondary"
        label={pending ? t('settings.signingOut') : t('settings.signOut')}
        pending={pending}
        onPress={() => {
          setPending(true);
          void session.signOut();
        }}
      />
    </Screen>
  );
}
