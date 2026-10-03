/** An outbound email. Templates and wording come from the message catalogue, never from here. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends one message. Hosted, `sesMailer` (apps/web/src/mail) through Amazon SES when `MAILER=ses`;
 * on a developer's machine the console mailer.
 */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Prints the whole message so a developer can follow an invite or reset link on their own machine. */
export function consoleMailer(write: (line: string) => void = console.warn): Mailer {
  return {
    send: (message) => {
      write(`[mail] to: ${message.to}\n[mail] subject: ${message.subject}\n${message.text}`);
      return Promise.resolve();
    },
  };
}

/**
 * For hosted environments that are not production and have no mail provider yet: records that a
 * message went out, never its body, because a set-password link in a log is a way into an account
 * for anyone who can read the log (AUDIT M9).
 */
export function recipientOnlyMailer(write: (line: string) => void = console.warn): Mailer {
  return {
    send: (message) => {
      write(`[mail] to: ${message.to}\n[mail] subject: ${message.subject}\n[mail] body withheld`);
      return Promise.resolve();
    },
  };
}

/** Keeps every message for assertions. */
export function memoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}
