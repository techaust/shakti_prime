import { Linking } from 'react-native';
import { Body, Button, Screen } from '../components/ui';
import { appVersion, STORE_URL } from '../config';
import { t } from '../i18n';

/**
 * The update gate (FLD-03): below the oldest version the server serves, the app does no work and
 * sends the engineer to the Play Store.
 */
export function UpdateScreen({ minimum }: { minimum?: string | undefined }) {
  return (
    <Screen title={t('update.title')}>
      <Body>{t('update.body')}</Body>
      {minimum === undefined ? null : (
        <Body muted>{t('update.yours', { version: appVersion(), minimum })}</Body>
      )}
      <Button label={t('update.open')} onPress={() => void Linking.openURL(STORE_URL)} />
    </Screen>
  );
}
