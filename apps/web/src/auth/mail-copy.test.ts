import { describe, expect, it } from 'vitest';
import { twoFactorResetMail } from './mail-copy';

describe('twoFactorResetMail', () => {
  it('greets the user by name, tells them what to do next and names no one else', () => {
    const mail = twoFactorResetMail({ email: 'meena@shakti.test', name: 'Meena' });
    expect(mail.to).toBe('meena@shakti.test');
    expect(mail.subject).toBe('Your Shakti Prime authenticator app was reset');
    expect(mail.text).toMatch(/^Hello Meena,\n\n/);
    expect(mail.text).toContain('Sign in again with your password');
    expect(mail.text).toContain("If you didn't ask for this, tell your manager today.");
    expect(mail.text).not.toMatch(/\{|\}/);
  });
});
