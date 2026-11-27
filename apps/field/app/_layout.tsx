import '../global.css';
import { Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSessionState } from '../src/auth/session-context';
import { t } from '../src/i18n';
import { SignInScreen } from '../src/screens/sign-in-screen';
import { UnlockScreen } from '../src/screens/unlock-screen';
import { UpdateScreen } from '../src/screens/update-screen';
import { startSentry } from '../src/observability/sentry';
import { ThemeRoot } from '../src/theme';

startSentry();

/**
 * The app's frame: the theme, the session and the gate. Until the person is signed in, has opened
 * the app with their PIN or fingerprint and runs a version the server still serves, the gate shows
 * that step instead of the tabs.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeRoot>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </ThemeRoot>
    </SafeAreaProvider>
  );
}

function Gate() {
  const state = useSessionState();
  switch (state.status) {
    case 'loading':
      return (
        <View className="flex-1 items-center justify-center bg-bg">
          <ActivityIndicator accessibilityLabel={t('app.name')} />
        </View>
      );
    case 'signedOut':
      return <SignInScreen notice={state.notice} />;
    case 'locked':
      return <UnlockScreen key={String(state.hasPin)} hasPin={state.hasPin} />;
    case 'updateRequired':
      return <UpdateScreen minimum={state.minimum} />;
    case 'ready':
      return (
        <Tabs screenOptions={{ headerShown: false }}>
          <Tabs.Screen name="index" options={{ title: t('tabs.today') }} />
          <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
        </Tabs>
      );
  }
}
