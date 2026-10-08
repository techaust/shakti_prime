import type { LeadChannel } from '@shakti/contracts';

/** Lead sources from docs/01-blueprint.md §2, named the way callers describe them. */
export const LEAD_SOURCE_SEED: readonly {
  id: string;
  code: string;
  channel: LeadChannel;
  name: string;
}[] = [
  {
    id: '01990000-0000-7000-8000-000000000601',
    code: 'meta_ads',
    channel: 'meta_ads',
    name: 'Facebook and Instagram ads',
  },
  {
    id: '01990000-0000-7000-8000-000000000602',
    code: 'google_ads',
    channel: 'google_ads',
    name: 'Google ads',
  },
  {
    id: '01990000-0000-7000-8000-000000000603',
    code: 'website',
    channel: 'website',
    name: 'Website enquiry',
  },
  {
    id: '01990000-0000-7000-8000-000000000604',
    code: 'whatsapp',
    channel: 'whatsapp',
    name: 'WhatsApp message',
  },
  {
    id: '01990000-0000-7000-8000-000000000605',
    code: 'ivr',
    channel: 'ivr',
    name: 'Incoming call',
  },
  {
    id: '01990000-0000-7000-8000-000000000606',
    code: 'missed_call',
    channel: 'missed_call',
    name: 'Missed call',
  },
  {
    id: '01990000-0000-7000-8000-000000000607',
    code: 'walk_in',
    channel: 'walk_in',
    name: 'Walk-in',
  },
  {
    id: '01990000-0000-7000-8000-000000000608',
    code: 'referral',
    channel: 'referral',
    name: 'Referral',
  },
  {
    id: '01990000-0000-7000-8000-000000000609',
    code: 'import',
    channel: 'import',
    name: 'Imported list',
  },
  {
    id: '01990000-0000-7000-8000-000000000610',
    code: 'manual',
    channel: 'manual',
    name: 'Added by staff',
  },
];
