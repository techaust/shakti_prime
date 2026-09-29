import { logger } from '../log';

/**
 * The alerts the owner is notified of through Sentry (docs/runbooks/DEPLOY.md §1.5): the rule in
 * Sentry matches the message, which is the alert's name.
 */
export type AlertName = 'outbox.dead_lettered' | 'outbox.publisher_failing';

/** What an alert carries: counts and ids only, never a payload or a person's details. */
export type AlertFields = Readonly<Record<string, number | readonly string[] | undefined>>;

export interface AlertSink {
  report(name: AlertName, fields: AlertFields): void;
}

/**
 * Logs the alert as an error line and sends it to Sentry as one message whose fingerprint is its
 * name, so repeats group into one issue. Sentry is loaded on first use, and without a DSN it is
 * never started, so the call then only logs. Sending never fails the caller.
 */
export const sentryAlertSink: AlertSink = {
  report(name, fields) {
    logger.log('error', name, fields);
    void import('@sentry/nextjs')
      .then((sentry) => {
        sentry.captureMessage(name, { level: 'error', fingerprint: [name], extra: { ...fields } });
      })
      .catch((error: unknown) => {
        logger.log('warn', 'alert.send_failed', { alert: name, error });
      });
  },
};

/** For tests: keeps what it is told. */
export function memoryAlertSink(): AlertSink & {
  alerts: { name: AlertName; fields: AlertFields }[];
} {
  const alerts: { name: AlertName; fields: AlertFields }[] = [];
  return {
    alerts,
    report(name, fields) {
      alerts.push({ name, fields });
    },
  };
}
