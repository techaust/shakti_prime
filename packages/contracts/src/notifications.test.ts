import { describe, expect, it } from 'vitest';
import {
  isNoticeEvent,
  isPushServiceEndpoint,
  SetNotificationSettingsInput,
} from './notifications';

describe('notification contracts (docs/03-roadmap-appendix/phase1.md §8.1)', () => {
  it('accepts only https addresses of the push services the app sends to', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-bl2p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isPushServiceEndpoint(ok)).toBe(true);
    }
    for (const refused of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:secret@fcm.googleapis.com/abc',
      'https://fcm.googleapis.com.example.org/abc',
      'https://notify.windows.com.example.org/abc',
      'https://169.254.169.254/latest/meta-data',
      'not an address',
    ]) {
      expect(isPushServiceEndpoint(refused)).toBe(false);
    }
  });

  it('takes quiet hours as both times or neither, never the same time', () => {
    const parse = (quietFrom: string | null, quietTo: string | null) =>
      SetNotificationSettingsInput.safeParse({ types: [], quietFrom, quietTo });
    expect(parse(null, null).success).toBe(true);
    expect(parse('22:00', '07:00').success).toBe(true);
    expect(parse('22:00', null).error?.issues[0]?.message).toBe('quiet_hours_incomplete');
    expect(parse('22:00', '22:00').error?.issues[0]?.message).toBe('quiet_hours_empty');
    expect(parse('24:00', '07:00').success).toBe(false);
  });

  it('takes each kind of notice at most once', () => {
    const choice = { type: 'call_due', inApp: true, push: false };
    expect(
      SetNotificationSettingsInput.safeParse({
        types: [choice, choice],
        quietFrom: null,
        quietTo: null,
      }).success,
    ).toBe(false);
  });

  it('names the events that notify', () => {
    expect(isNoticeEvent('crm.opportunity.assigned')).toBe(true);
    expect(isNoticeEvent('crm.lead.created')).toBe(false);
  });
});
