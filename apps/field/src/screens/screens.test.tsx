import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';
import type { Api } from '../auth/api';
import type { Biometrics } from '../auth/session';
import { createSession } from '../auth/session';
import { SessionProvider } from '../auth/session-context';
import { tokenStore } from '../auth/token-store';
import { t } from '../i18n';
import { fakeApi, no } from '../test/fake-api';
import { SignInScreen } from './sign-in-screen';
import { UnlockScreen } from './unlock-screen';
import { UpdateScreen } from './update-screen';

const values = (SecureStore as unknown as { __values: Map<string, string> }).__values;

beforeEach(() => {
  values.clear();
});

function withSession(api: ReturnType<typeof fakeApi>) {
  const session = createSession(api as unknown as Api);
  return {
    session,
    wrap: (ui: React.ReactElement) => <SessionProvider session={session}>{ui}</SessionProvider>,
  };
}

describe('the sign-in screen', () => {
  it('signs in with the email and password and moves on to choosing a PIN', async () => {
    const api = fakeApi();
    const { session, wrap } = withSession(api);
    await render(wrap(<SignInScreen />));
    await fireEvent.changeText(
      screen.getByLabelText(t('signIn.email')),
      ' rakesh.meena@shaktisupreme.in ',
    );
    await fireEvent.changeText(
      screen.getByLabelText(t('signIn.password')),
      'monsoon pump 2026 river',
    );
    await fireEvent.press(screen.getByRole('button', { name: t('signIn.submit') }));
    await waitFor(() => {
      expect(session.getState()).toEqual({ status: 'locked', hasPin: false });
    });
    expect(api.signIn).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'rakesh.meena@shaktisupreme.in',
        password: 'monsoon pump 2026 river',
      }),
    );
  });

  it('asks for the authenticator code when the role needs one, and shows a refusal in plain words', async () => {
    const api = fakeApi({ signIn: jest.fn(() => no('totp_required')) });
    const { wrap } = withSession(api);
    await render(wrap(<SignInScreen />));
    expect(screen.queryByLabelText(t('signIn.code'))).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t('signIn.submit') }));
    expect(await screen.findByText(t('errors.totp_required'))).toBeTruthy();
    expect(screen.getByLabelText(t('signIn.code'))).toBeTruthy();

    api.signIn.mockImplementation(() => no('invalid_credentials'));
    await fireEvent.press(screen.getByRole('button', { name: t('signIn.submit') }));
    expect(await screen.findByText(t('errors.invalid_credentials'))).toBeTruthy();
  });

  it('says why the phone was signed out', async () => {
    const { wrap } = withSession(fakeApi());
    await render(wrap(<SignInScreen notice="errors.device_revoked" />));
    expect(screen.getByText(t('errors.device_revoked'))).toBeTruthy();
  });
});

const noBiometrics: Biometrics = {
  available: () => Promise.resolve(false),
  confirm: () => Promise.resolve(false),
};

describe('the unlock screen', () => {
  it('has a new PIN chosen and typed again, and starts over when the two differ', async () => {
    const api = fakeApi();
    const { session, wrap } = withSession(api);
    await session.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await render(wrap(<UnlockScreen hasPin={false} biometrics={noBiometrics} />));
    expect(screen.getByText(t('unlock.chooseTitle'))).toBeTruthy();
    const pin = () => screen.getByLabelText(t('unlock.pin'));
    const next = () => fireEvent.press(screen.getByRole('button', { name: t('unlock.submit') }));
    await fireEvent.changeText(pin(), '12');
    await next();
    expect(screen.getByText(t('unlock.pinLength'))).toBeTruthy();
    await fireEvent.changeText(pin(), '2468');
    await next();
    expect(screen.getByText(t('unlock.confirmTitle'))).toBeTruthy();
    await fireEvent.changeText(pin(), '2469');
    await next();
    expect(screen.getByText(t('unlock.mismatch'))).toBeTruthy();
    await fireEvent.changeText(pin(), '2468');
    await next();
    await fireEvent.changeText(pin(), '2468');
    await next();
    await waitFor(() => {
      expect(session.getState()).toMatchObject({ status: 'ready' });
    });
    expect(await tokenStore.pin()).toBe('2468');
  });

  it('opens with the PIN, counts the tries left, and offers the fingerprint when the phone has one', async () => {
    const { session, wrap } = withSession(fakeApi());
    await session.signIn('rakesh.meena@shaktisupreme.in', 'monsoon pump 2026 river');
    await tokenStore.savePin('2468');
    const confirm = jest.fn(() => Promise.resolve(true));
    await render(
      wrap(
        <UnlockScreen hasPin biometrics={{ available: () => Promise.resolve(true), confirm }} />,
      ),
    );
    await fireEvent.changeText(screen.getByLabelText(t('unlock.pin')), '1111');
    await fireEvent.press(screen.getByRole('button', { name: t('unlock.submit') }));
    expect(await screen.findByText(t('unlock.wrong', { count: 4 }))).toBeTruthy();
    await fireEvent.press(await screen.findByRole('button', { name: t('unlock.biometric') }));
    await waitFor(() => {
      expect(session.getState()).toMatchObject({ status: 'ready' });
    });
    expect(confirm).toHaveBeenCalledWith(t('unlock.biometricPrompt'));
  });
});

describe('the update gate', () => {
  it('names both versions and opens the Play Store', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<UpdateScreen minimum="1.2.0" />);
    expect(screen.getByText(t('update.title'))).toBeTruthy();
    expect(
      screen.getByText(t('update.yours', { version: '1.0.0', minimum: '1.2.0' })),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t('update.open') }));
    expect(open).toHaveBeenCalledWith('market://details?id=com.shaktiprime.field');
  });
});
