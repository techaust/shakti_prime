import { logger } from '../log';
import { SENTRY_FLUSH_MS, sentryDsnSet, type AlertName } from './sentry-on';

export { ALERT_NAMES, type AlertName } from './sentry-on';

/** What an alert carries: counts, ids and job names only, never a payload or a person's details. */
export type AlertFields = Readonly<Record<string, number | string | readonly string[] | undefined>>;

export interface AlertSink {
  /** Resolves once the alert is logged and, with a DSN, sent; it never rejects. */
  report(name: AlertName, fields: AlertFields): Promise<void>;
}

/**
 * Logs the alert as an error line and sends it to Sentry as one message whose fingerprint is its
 * name, and its job for a job's alert, so repeats group into one issue per job. The send is
 * flushed before `report` resolves, so a function that awaits it is not frozen with the alert
 * still queued. Without `SENTRY_DSN` the SDK is not even loaded and the alert is only logged.
 * Sending never fails the caller.
 */
export const sentryAlertSink: AlertSink = {
  async report(name, fields) {
    logger.log('error', name, fields);
    if (!sentryDsnSet()) return;
    try {
      const sentry = await import('@sentry/nextjs');
      const job = typeof fields.job === 'string' ? [fields.job] : [];
      sentry.captureMessage(name, {
        level: 'error',
        fingerprint: [name, ...job],
        extra: { ...fields },
      });
      await sentry.flush(SENTRY_FLUSH_MS);
    } catch (error) {
      logger.log('warn', 'alert.send_failed', { alert: name, error });
    }
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
      return Promise.resolve();
    },
  };
}
