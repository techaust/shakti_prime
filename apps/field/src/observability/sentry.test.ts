import * as Sentry from '@sentry/react-native';
import { startSentry } from './sentry';

jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));

describe('starting Sentry', () => {
  it('sends nothing from a build without a DSN, and scrubs every event of one that has it', () => {
    expect(startSentry({})).toBe(false);
    expect(startSentry({ dsn: ' ' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(startSentry({ dsn: 'https://key@o1.ingest.sentry.io/2', environment: 'staging' })).toBe(
      true,
    );
    const options = (Sentry.init as unknown as jest.Mock).mock.calls[0]?.[0] as {
      sendDefaultPii?: boolean;
      beforeSend: (event: object) => object;
    };
    expect(options.sendDefaultPii).toBeUndefined();
    expect(options).toMatchObject({
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      environment: 'staging',
      release: 'shakti-field@1.0.0',
    });
    expect(options.beforeSend({ extra: { refreshToken: 'r'.repeat(43) } })).toEqual({
      extra: { refreshToken: '[redacted]' },
    });
    // Started once only.
    expect(startSentry({ dsn: 'https://key@o1.ingest.sentry.io/2' })).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});
