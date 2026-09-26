import type { LeadChannel } from '@shakti/contracts';

/** Lead sources from docs/BLUEPRINT.md §2, named the way callers describe them. */
export const LEAD_SOURCE_SEED: readonly {
  id: string;
  code: string;
  channel: LeadChannel;
  name: string;
  nameHi: string;
}[] = [
  {
    id: '01990000-0000-7000-8000-000000000601',
    code: 'meta_ads',
    channel: 'meta_ads',
    name: 'Facebook and Instagram ads',
    nameHi: 'फ़ेसबुक और इंस्टाग्राम विज्ञापन',
  },
  {
    id: '01990000-0000-7000-8000-000000000602',
    code: 'google_ads',
    channel: 'google_ads',
    name: 'Google ads',
    nameHi: 'गूगल विज्ञापन',
  },
  {
    id: '01990000-0000-7000-8000-000000000603',
    code: 'website',
    channel: 'website',
    name: 'Website enquiry',
    nameHi: 'वेबसाइट से पूछताछ',
  },
  {
    id: '01990000-0000-7000-8000-000000000604',
    code: 'whatsapp',
    channel: 'whatsapp',
    name: 'WhatsApp message',
    nameHi: 'व्हाट्सऐप संदेश',
  },
  {
    id: '01990000-0000-7000-8000-000000000605',
    code: 'ivr',
    channel: 'ivr',
    name: 'Incoming call',
    nameHi: 'आई हुई कॉल',
  },
  {
    id: '01990000-0000-7000-8000-000000000606',
    code: 'missed_call',
    channel: 'missed_call',
    name: 'Missed call',
    nameHi: 'मिस्ड कॉल',
  },
  {
    id: '01990000-0000-7000-8000-000000000607',
    code: 'walk_in',
    channel: 'walk_in',
    name: 'Walk-in',
    nameHi: 'दुकान पर आए',
  },
  {
    id: '01990000-0000-7000-8000-000000000608',
    code: 'referral',
    channel: 'referral',
    name: 'Referral',
    nameHi: 'रेफ़रल',
  },
  {
    id: '01990000-0000-7000-8000-000000000609',
    code: 'import',
    channel: 'import',
    name: 'Imported list',
    nameHi: 'सूची से जोड़ा',
  },
  {
    id: '01990000-0000-7000-8000-000000000610',
    code: 'manual',
    channel: 'manual',
    name: 'Added by staff',
    nameHi: 'स्टाफ़ ने जोड़ा',
  },
];
