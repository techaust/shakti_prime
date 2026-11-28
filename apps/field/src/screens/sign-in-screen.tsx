import { useState } from 'react';
import { Body, Button, Field, Notice, Screen } from '../components/ui';
import { useSession } from '../auth/session-context';
import { t, type MessageKey } from '../i18n';

/**
 * Sign in with the person's website email and password, and the authenticator code when their role
 * needs one (the server asks for it). Once in, the person chooses a PIN on the unlock screen.
 */
export function SignInScreen({ notice }: { notice?: MessageKey | undefined }) {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(undefined);
    const outcome = await session.signIn(
      email.trim(),
      password,
      needsCode ? code.trim() : undefined,
    );
    setPending(false);
    if (!outcome.ok) {
      setError(outcome.error);
      if (outcome.needsCode) setNeedsCode(true);
    }
  }

  return (
    <Screen title={t('signIn.title')}>
      <Body muted>{t('signIn.intro')}</Body>
      {notice === undefined || error !== undefined ? null : (
        <Notice tone="info">{t(notice)}</Notice>
      )}
      {error === undefined ? null : <Notice>{t(error)}</Notice>}
      <Field
        label={t('signIn.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label={t('signIn.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
      />
      {needsCode ? (
        <Field
          label={t('signIn.code')}
          hint={t('signIn.codeHint')}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
        />
      ) : null}
      <Button
        label={pending ? t('signIn.pending') : t('signIn.submit')}
        pending={pending}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
