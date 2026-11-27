import { newId } from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  HEARTBEAT_SILENCE_MS,
  readTallyConnectorAlerts,
  recordTallyAlert,
  shouldAlertHeldRows,
  shouldAlertSilence,
} from '@shakti/domain';
import { logger } from '../log';
import type { AlertSink } from '../observability/alerts';
import { systemWorkersPrincipal } from './events/system-principal';

/** The job name a fault of these alerts is told under, as the Phase 2 alerts are. */
export const TALLY_ALERTS_JOB = 'tally-alerts';

/**
 * TC2's two connector alerts, run by the hourly jobs check as `system:workers`
 * (docs/03-roadmap-appendix/phase5.md §6.3): a connector silent for thirty minutes
 * (`tally.connector.silent`, once per silence, `shouldAlertSilence`) and one holding outbox rows it
 * could not send (`tally.connector.rows_held`, once per stretch of held rows). Each alert names the
 * connector by id and counts only; once told, it is recorded (`tally.connector.record_alert`), so
 * it is not told again until the connector checks in and falls silent, or clears its rows and
 * holds some again. A connector that never checked in is not silent: it was never started.
 */
export async function runTallyAlerts(options: {
  requestId: string;
  alerts: AlertSink;
  now: Date;
}): Promise<{ alerted: number }> {
  const { requestId, alerts, now } = options;
  const workers = systemWorkersPrincipal(null);
  const connectors = await executeQuery(
    workers,
    { entityIds: [], requestId },
    (context) => readTallyConnectorAlerts(context),
    { name: 'readTallyConnectorAlerts' },
  );
  let alerted = 0;
  const record = async (connectorId: string, alert: 'silent' | 'rows_held') => {
    try {
      await executeCommand(
        workers,
        { entityIds: [], requestId: newId() },
        recordTallyAlert,
        { connectorId, alert },
      );
    } catch (error) {
      // Not recorded: the next check tells it again, which beats not telling.
      logger.log('warn', 'tally.alert_not_recorded', { requestId, connectorId, alert, error });
    }
  };
  for (const c of connectors) {
    if (shouldAlertSilence(c.lastHeartbeatAt, c.silenceAlertedAt, now)) {
      const quietMs = now.getTime() - (c.lastHeartbeatAt?.getTime() ?? now.getTime());
      await alerts.report('tally.connector.silent', {
        subject: c.connectorId,
        minutes: Math.floor(Math.max(quietMs, HEARTBEAT_SILENCE_MS) / 60_000),
      });
      await record(c.connectorId, 'silent');
      alerted += 1;
    }
    if (shouldAlertHeldRows(c)) {
      await alerts.report('tally.connector.rows_held', {
        subject: c.connectorId,
        heldRows: c.heldRows,
      });
      await record(c.connectorId, 'rows_held');
      alerted += 1;
    }
  }
  return { alerted };
}
