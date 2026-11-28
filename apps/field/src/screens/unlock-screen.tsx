import { useEffect, useState } from 'react';
import { Body, Button, Field, Notice, Screen } from '../components/ui';
import { phoneBiometrics, useSession } from '../auth/session-context';
import type { Biometrics } from '../auth/session';
import { t, type MessageKey } from '../i18n';

const PIN = /^\d{4}$/;

type Step = 'choose' | 'confirm' | 'enter';

/**
 * Opens the app with the 4-digit PIN or the phone's fingerprint (docs/03-roadmap-appendix/phase4.md
 * §2, question 7). Right after a sign-in the person chooses the PIN and types it again.
 */
export function UnlockScreen({
  hasPin,
  biometrics = phoneBiometrics,
}: {
  hasPin: boolean;
  biometrics?: Biometrics;
}) {
  const session = useSession();
  const [step, setStep] = useState<Step>(hasPin ? 'enter' : 'choose');
  const [pin, setPin] = useState('');
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState<{ key: MessageKey; count?: number } | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [canUseBiometric, setCanUseBiometric] = useState(false);

  useEffect(() => {
    if (step !== 'enter') return;
    let live = true;
    void biometrics.available().then((available) => {
      if (live) setCanUseBiometric(available);
    });
    return () => {
      live = false;
    };
  }, [biometrics, step]);

  async function submit() {
    if (!PIN.test(pin)) {
      setError({ key: 'unlock.pinLength' });
      return;
    }
    setError(undefined);
    if (step === 'choose') {
      setChosen(pin);
      setPin('');
      setStep('confirm');
      return;
    }
    setPending(true);
    if (step === 'confirm') {
      if (pin !== chosen) {
        setPending(false);
        setPin('');
        setChosen('');
        setStep('choose');
        setError({ key: 'unlock.mismatch' });
        return;
      }
      await session.choosePin(pin);
      return;
    }
    const wrong = await session.unlockWithPin(pin);
    setPending(false);
    setPin('');
    if (wrong !== undefined && wrong.triesLeft > 0) {
      setError({ key: 'unlock.wrong', count: wrong.triesLeft });
    }
  }

  const title =
    step === 'choose'
      ? 'unlock.chooseTitle'
      : step === 'confirm'
        ? 'unlock.confirmTitle'
        : 'unlock.enterTitle';
  const intro =
    step === 'choose'
      ? 'unlock.chooseIntro'
      : step === 'confirm'
        ? 'unlock.confirmIntro'
        : 'unlock.enterIntro';

  return (
    <Screen title={t(title)}>
      <Body muted>{t(intro)}</Body>
      {error === undefined ? null : (
        <Notice>{t(error.key, error.count === undefined ? {} : { count: error.count })}</Notice>
      )}
      <Field
        label={t('unlock.pin')}
        value={pin}
        onChangeText={(value) => {
          setPin(value.replace(/\D/g, '').slice(0, 4));
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
      />
      <Button label={t('unlock.submit')} pending={pending} onPress={() => void submit()} />
      {step === 'enter' && canUseBiometric ? (
        <Button
          variant="secondary"
          label={t('unlock.biometric')}
          onPress={() => void session.unlockWithBiometric(biometrics, t('unlock.biometricPrompt'))}
        />
      ) : null}
    </Screen>
  );
}
