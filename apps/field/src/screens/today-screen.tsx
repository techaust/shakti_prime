import { View } from 'react-native';
import { useSessionState } from '../auth/session-context';
import { Body, Notice, Screen } from '../components/ui';
import { t } from '../i18n';

/** Today's visits and jobs; empty until scheduling and the sync engine bring them (F2, F3). */
export function TodayScreen() {
  const state = useSessionState();
  const offline = state.status === 'ready' && state.offline;
  return (
    <Screen title={t('today.title')}>
      {offline ? <Notice tone="info">{t('today.offline')}</Notice> : null}
      <View className="gap-2 rounded-lg border border-border bg-surface p-6">
        <Body>{t('today.emptyTitle')}</Body>
        <Body muted>{t('today.emptyBody')}</Body>
      </View>
    </Screen>
  );
}
