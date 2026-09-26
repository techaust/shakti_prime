/** An outbound email. Templates and wording come from the message catalogue, never from here. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** SES implements this in Phase 1 (docs/ARCHITECTURE.md §7). Until then the console mailer. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Prints the message so a developer can follow an invite or reset link locally. */
export function consoleMailer(write: (line: string) => void = console.warn): Mailer {
  return {
    send: (message) => {
      write(`[mail] to: ${message.to}\n[mail] subject: ${message.subject}\n${message.text}`);
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
