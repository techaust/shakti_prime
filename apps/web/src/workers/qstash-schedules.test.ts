import { describe, expect, it } from 'vitest';
import { hostedEnvironment, qstashSchedules } from './qstash-schedules';
import { JOB_SCHEDULES } from './schedules';

const SITE = 'https://shaktiprime.com/api/v1/workers/outbox/publish';

describe('the QStash schedules of an environment', () => {
  it('names every production schedule for production, at its own site', () => {
    const schedules = qstashSchedules('production', SITE);
    expect(schedules.map((s) => s.scheduleId)).toEqual([
      'outbox-publish-production',
      'files-sweep-production',
      'lead-rescore-production',
      'duplicate-scan-production',
      'lead-anonymise-production',
      'quote-expire-production',
      'notification-scan-production',
      'jobs-check-production',
    ]);
    for (const schedule of schedules) {
      expect(schedule.destination).toMatch(/^https:\/\/shaktiprime\.com\/api\/v1\/workers\//);
      expect(schedule.cron).toBe(JOB_SCHEDULES[schedule.route]);
    }
    expect(schedules.find((s) => s.route === 'outbox-publish')?.destination).toBe(SITE);
  });

  it('has one schedule per timed route, so the schedules and the monitors never drift', () => {
    for (const environment of ['dev', 'staging', 'production'] as const) {
      const routes = qstashSchedules(environment, SITE).map((s) => s.route);
      expect(routes.sort()).toEqual(Object.keys(JOB_SCHEDULES).sort());
    }
    const dev = qstashSchedules('dev', 'https://shakti-prime-dev.vercel.app');
    expect(dev.every((s) => s.scheduleId.endsWith('-dev'))).toBe(true);
    expect(dev.find((s) => s.route === 'quote-expire')?.destination).toBe(
      'https://shakti-prime-dev.vercel.app/api/v1/workers/quotes/expire',
    );
  });

  it('retries the nightly and daily jobs only; the next call covers a frequent one', () => {
    const retries = Object.fromEntries(
      qstashSchedules('production', SITE).map((s) => [s.route, s.retries]),
    );
    expect(retries).toEqual({
      'outbox-publish': 0,
      'files-sweep': 0,
      'lead-rescore': 3,
      'duplicate-scan': 3,
      'lead-anonymise': 3,
      'quote-expire': 3,
      'notification-scan': 0,
      'jobs-check': 0,
    });
  });

  it('accepts only the three hosted environments', () => {
    expect(hostedEnvironment('production')).toBe('production');
    expect(hostedEnvironment('staging')).toBe('staging');
    for (const value of ['local', 'prod', 'Production', '', undefined]) {
      expect(hostedEnvironment(value)).toBeUndefined();
    }
  });
});
