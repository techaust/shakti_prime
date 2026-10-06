import type { ApiEndpointId } from './endpoints';

/**
 * Recorded examples for every `/api/v1` route (docs/API.md §7, AGENTS.md §7), read by the contract
 * tests only. People, numbers and ids are made up; tokens and signatures are built from repeated
 * bytes at load time, so no key-like literal sits in the source (the secret scan reads history).
 */

const b64url = (value: unknown): string =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** A compact JWT with the given header algorithm and claims and a filler signature. */
export function fixtureJwt(alg: 'ES256' | 'HS256', claims: Record<string, unknown>): string {
  const header = { alg, typ: 'JWT', ...(alg === 'ES256' ? { kid: 'bos-2026-09' } : {}) };
  return [b64url(header), b64url(claims), Buffer.alloc(64, 7).toString('base64url')].join('.');
}

export const ISSUED_AT = 1_790_500_000;
export const ISSUER = 'https://shaktiprime.com';

export const IDS = {
  user: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a01',
  userTeam: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a02',
  project: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a03',
  site: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a04',
  survey: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a05',
  slot: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a06',
  photo: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a07',
  selfie: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a08',
  receipt: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a09',
  checkIn: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0a',
  claim: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0b',
  claimLine: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0c',
  lead: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0d',
  voiceSession: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0e',
  qc: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a0f',
  event: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a10',
  eventB: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a11',
  file: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a12',
  quote: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a13',
  pdf: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a14',
  agentRun: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a15',
  call: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a16',
  audio: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a17',
  transcript: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a18',
  knowledgeFile: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a19',
  thread: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a1a',
  channel: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a1b',
  serialA: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a1c',
  serialB: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a1d',
  importJob: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a1e',
  probe: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a1f',
  device: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  connector: '2b7e1516-28ae-4d2a-9f15-1b3c4d5e6f70',
  commandA: '9c1d2e3f-4a5b-4c6d-9e8f-0a1b2c3d4e51',
  commandB: '9c1d2e3f-4a5b-4c6d-9e8f-0a1b2c3d4e52',
  commandC: '9c1d2e3f-4a5b-4c6d-9e8f-0a1b2c3d4e53',
} as const;

const TALLY_COMPANY_GUID = '5d0c6a2e-8f3b-4e1a-9c7d-2b4f6a8c0e1d';
export const tallyGuid = (masterId: number): string =>
  `${TALLY_COMPANY_GUID}-${masterId.toString(16).padStart(8, '0')}`;

const refreshToken = Buffer.alloc(32, 1).toString('base64url');

const mobileClaims = {
  iss: ISSUER,
  sub: IDS.user,
  aud: 'shakti-mobile',
  sid: IDS.device,
  entity_ids: [1],
  bos_role: 'field_engineer',
  iat: ISSUED_AT,
  exp: ISSUED_AT + 15 * 60,
};

export const REALTIME_CLAIMS = {
  iss: ISSUER,
  sub: IDS.user,
  aud: 'shakti-realtime',
  role: 'authenticated',
  bos_role: 'tele_caller_cc',
  entity_ids: [1, 3],
  iat: ISSUED_AT,
  exp: ISSUED_AT + 15 * 60,
};

export const VOICE_CLAIMS = {
  iss: ISSUER,
  sub: IDS.user,
  aud: 'shakti-voice',
  sid: IDS.voiceSession,
  bos_role: 'executive',
  entity_ids: [1, 2, 3, 4],
  iat: ISSUED_AT,
  exp: ISSUED_AT + 5 * 60,
};

export const MOBILE_CLAIMS = mobileClaims;

const tokenPair = {
  tokenType: 'Bearer',
  accessToken: fixtureJwt('ES256', mobileClaims),
  accessTokenExpiresAt: '2026-09-27T05:21:40.000Z',
  refreshToken,
  refreshTokenExpiresAt: '2026-10-27T05:06:40.000Z',
  userId: IDS.user,
};

const voucher = {
  guid: tallyGuid(0x1a2b),
  alterId: 48213,
  type: 'receipt',
  typeName: 'Receipt',
  voucherNo: 'RCPT/2026-27/0412',
  date: '2026-09-26',
  partyName: 'Kisan Seva Kendra Bikaner',
  partyGstin: '08ABCDE1234F1Z5',
  buyerOrderNo: 'SS/SO/2026-27/0187',
  amount: '125000.00',
  isCancelled: false,
  isOptional: false,
  ledgerEntries: [
    { ledgerName: 'Kisan Seva Kendra Bikaner', amount: '-125000.00' },
    { ledgerName: 'State Bank of India Current Account', amount: '125000.00' },
  ],
  inventoryEntries: [],
};

const salesVoucher = {
  ...voucher,
  guid: tallyGuid(0x1a2c),
  alterId: 48214,
  type: 'sales',
  typeName: 'Sales GST',
  voucherNo: 'SS/INV/2026-27/0098',
  amount: '118000.00',
  ledgerEntries: [
    { ledgerName: 'Kisan Seva Kendra Bikaner', amount: '118000.00' },
    { ledgerName: 'Sales Solar Pumps 12%', amount: '-105357.14' },
    { ledgerName: 'Output CGST 6%', amount: '-6321.43' },
    { ledgerName: 'Output SGST 6%', amount: '-6321.43' },
  ],
  inventoryEntries: [
    {
      stockItemName: '5 HP AC Solar Pump Set',
      quantity: '1',
      unit: 'Set',
      rate: '105357.14',
      amount: '-105357.14',
      godown: 'Bikaner Main',
    },
  ],
};

/** An outbox event as the publisher delivers it (`DeliveredEvent`). */
const deliveredEvent = {
  id: IDS.event,
  sequence: '48213',
  type: 'crm.lead.created',
  entityId: 1,
  aggregateType: 'opportunity',
  aggregateId: IDS.lead,
  payload: {
    v: 1,
    pipelineKey: 'farmer_pumps',
    sourceCode: 'meta_lead_ads',
    existingAccount: false,
  },
};

/** One recorded example per route: what the caller sends and what the route answers. */
export const API_FIXTURES: Record<
  ApiEndpointId,
  { params?: unknown; query?: unknown; request?: unknown; response?: unknown }
> = {
  'auth.mobile.token': {
    request: {
      email: 'Engineer.Bikaner@shaktisupreme.in',
      password: ['monsoon', 'lantern', 'bikaner', 'field'].join(' '),
      device: {
        deviceId: IDS.device,
        platform: 'android',
        model: 'Redmi Note 13',
        osVersion: '14',
        appVersion: '1.4.0',
      },
    },
    response: tokenPair,
  },
  'auth.mobile.refresh': {
    request: { refreshToken, deviceId: IDS.device, appVersion: '1.4.0' },
    response: tokenPair,
  },
  'auth.mobile.revoke': {
    request: {},
    response: { revoked: true, deviceId: IDS.device },
  },
  me: {
    response: {
      principal: {
        id: IDS.user,
        kind: 'user',
        name: 'Mahendra Singh Rathore',
        email: 'mahendra.rathore@shaktisupreme.in',
        theme: 'system',
      },
      roles: [{ entityId: 1, entityCode: 'SS', roleKey: 'field_engineer', teamId: IDS.userTeam }],
      permissions: [
        { key: 'projects.read', scope: 'own' },
        { key: 'projects.write', scope: 'own' },
        { key: 'documents.write', scope: 'own' },
        { key: 'profile.write', scope: 'own' },
      ],
      featureFlags: { 'field.offline_surveys': true, 'field.qc_signature': false },
      minimumAppVersion: '1.2.0',
      latestAppVersion: '1.4.0',
      serverTime: '2026-09-27T05:06:40.000Z',
    },
  },
  'realtime.token': {
    request: {},
    response: {
      token: fixtureJwt('ES256', REALTIME_CLAIMS),
      expiresAt: '2026-09-27T05:21:40.000Z',
      channels: [`user:${IDS.user}`, 'entity:1:queue', 'entity:3:queue'],
    },
  },
  'voice.session': {
    request: { mode: 'ask', consentRecording: true },
    response: {
      sessionId: IDS.voiceSession,
      livekit: {
        url: 'wss://shakti-prime.livekit.cloud',
        roomName: IDS.voiceSession,
        participantToken: fixtureJwt('HS256', { sub: `user:${IDS.user}`, exp: ISSUED_AT + 3600 }),
        expiresAt: '2026-09-27T06:06:40.000Z',
      },
      bosToken: { token: fixtureJwt('ES256', VOICE_CLAIMS), expiresAt: '2026-09-27T05:11:40.000Z' },
      limits: { minutesRemainingToday: 42, maxSessionMinutes: 20 },
    },
  },
  'sync.pull': {
    query: { since: 'c_2026-09-26T18:30:00.000000Z_0199a0c4', limit: '500' },
    response: {
      changes: [
        {
          op: 'upsert',
          collection: 'schedule_slots',
          id: IDS.slot,
          updatedAt: '2026-09-27T03:30:00.000Z',
          record: {
            projectId: IDS.project,
            startsAt: '2026-09-27T04:30:00.000Z',
            endsAt: '2026-09-27T08:30:00.000Z',
            state: 'confirmed',
            travelMin: 55,
          },
        },
        {
          op: 'upsert',
          collection: 'surveys',
          id: IDS.survey,
          updatedAt: '2026-09-27T03:31:00.000Z',
          record: { projectId: IDS.project, siteId: IDS.site, answers: { borewellDepthM: 180 } },
        },
        {
          op: 'delete',
          collection: 'schedule_slots',
          id: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a10',
          updatedAt: '2026-09-27T03:32:00.000Z',
        },
      ],
      nextCursor: 'c_2026-09-27T03:32:00.000000Z_0199a0c4',
      hasMore: false,
      serverTime: '2026-09-27T05:06:40.000Z',
    },
  },
  'sync.push': {
    request: {
      commands: [
        {
          id: IDS.survey,
          name: 'projects.survey.submit',
          input: { surveyId: IDS.survey, answers: { borewellDepthM: 185, waterLevelM: 120 } },
          idempotencyKey: IDS.commandA,
          clientTime: '2026-09-27T06:10:00.000Z',
        },
        {
          id: IDS.qc,
          name: 'projects.qc.record',
          input: { projectId: IDS.project, items: { earthing: 'pass', panelTilt: 'pass' } },
          idempotencyKey: IDS.commandB,
          clientTime: '2026-09-27T07:45:00.000Z',
        },
        {
          id: IDS.qc,
          name: 'projects.qc.sign_off',
          input: { projectId: IDS.project, signatureFileId: IDS.photo },
          idempotencyKey: IDS.commandC,
          clientTime: '2026-09-27T07:50:00.000Z',
        },
      ],
    },
    response: {
      results: [
        {
          idempotencyKey: IDS.commandA,
          id: IDS.survey,
          status: 'applied',
          output: { id: IDS.survey, state: 'submitted' },
        },
        {
          idempotencyKey: IDS.commandB,
          id: IDS.qc,
          status: 'conflict',
          reason: 'state_changed',
          server: { state: 'on_hold' },
        },
        { idempotencyKey: IDS.commandC, id: IDS.qc, status: 'held', blockedBy: IDS.commandB },
      ],
      serverTime: '2026-09-27T09:02:11.000Z',
    },
  },
  'files.presign': {
    request: {
      entityId: 1,
      purpose: 'signed_quote',
      name: 'Signed quote SS-QT-0231.jpg',
      contentType: 'image/jpeg',
      size: 842_113,
      sha256: 'a3f1c2d4e5b6a7980112233445566778899aabbccddeeff00112233445566778',
    },
    response: {
      fileId: IDS.photo,
      method: 'PUT',
      uploadUrl: `https://shakti-prime-staging-files.s3.ap-south-1.amazonaws.com/1/signed_quote/${IDS.photo}.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bx-amz-checksum-sha256%3Bx-amz-server-side-encryption%3Bx-amz-server-side-encryption-aws-kms-key-id`,
      headers: {
        'content-type': 'image/jpeg',
        'x-amz-checksum-sha256': 'o/HC1OW2p5gBEiM0RVZneImaq7zN3u/wARIjNEVWZ3g=',
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': 'alias/shakti-prime-staging-files',
      },
      expiresAt: '2026-09-27T05:21:40.000Z',
    },
  },
  'files.complete': {
    params: { id: IDS.photo },
    request: { purpose: 'signed_quote' },
    response: { fileId: IDS.photo, status: 'scanning' },
  },
  'attendance.checkIn': {
    request: {
      id: IDS.checkIn,
      entityId: 1,
      type: 'site_in',
      at: '2026-09-27T04:41:00.000Z',
      geo: { lat: 28.0229, lng: 73.3119, accuracyM: 12 },
      selfieFileId: IDS.selfie,
      siteId: IDS.site,
      projectId: IDS.project,
    },
    response: {
      id: IDS.checkIn,
      recordedAt: '2026-09-27T05:06:41.000Z',
      withinGeofence: true,
      distanceM: 38,
      needsReview: false,
    },
  },
  'expenses.create': {
    request: {
      id: IDS.claim,
      entityId: 1,
      projectId: IDS.project,
      lines: [
        {
          id: IDS.claimLine,
          category: 'fuel',
          spentOn: '2026-09-26',
          amount: '640.00',
          description: 'Diesel for the site visit to Nokha',
          receiptFileIds: [IDS.receipt],
        },
      ],
    },
    response: { id: IDS.claim, state: 'submitted', total: '640.00', overLimitLineIds: [] },
  },
  'ingest.leads': {
    request: {
      entityCode: 'ASH',
      name: 'Bhanwar Lal Choudhary',
      phone: '098290 00017',
      pin: '334001',
      segment: 'farmer_pumps',
      message: 'Need a 7.5 HP solar pump for a 250 foot borewell',
      utm: { source: 'facebook', medium: 'cpc', campaign: 'kusum-rabi-2026' },
      consent: {
        purpose: 'service',
        text: 'I agree that Agro Solar Hub may call me and message me on WhatsApp about my enquiry.',
        givenAt: '2026-09-27T04:12:09.000Z',
      },
      turnstileToken: 'x'.repeat(40),
    },
    response: { leadId: IDS.lead, outcome: 'created' },
  },
  'ingest.health': {
    response: {
      keyValid: true,
      entityCode: 'ASH',
      rateLimit: { limit: 60, remaining: 57, resetAt: '2026-09-27T05:07:00.000Z' },
    },
  },
  'webhooks.whatsapp.verify': {
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'v'.repeat(24),
      'hub.challenge': '1158201444',
    },
  },
  'webhooks.whatsapp': {
    request: {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '919000000101',
                  phone_number_id: '106540352242922',
                },
                contacts: [{ profile: { name: 'Ramniwas' }, wa_id: '919000000017' }],
                messages: [
                  {
                    from: '919000000017',
                    id: 'wamid.inbound-0001',
                    timestamp: '1790500000',
                    type: 'text',
                    text: { body: 'Pump ka quote bhej do, 5 HP' },
                  },
                ],
              },
            },
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '919000000101',
                  phone_number_id: '106540352242922',
                },
                statuses: [
                  {
                    id: 'wamid.outbound-0042',
                    status: 'delivered',
                    timestamp: '1790500012',
                    recipient_id: '919000000017',
                    conversation: { id: 'conversation-0007', origin: { type: 'service' } },
                    pricing: { billable: false, pricing_model: 'PMP', category: 'service' },
                  },
                ],
              },
            },
            {
              field: 'message_template_status_update',
              value: {
                event: 'APPROVED',
                message_template_id: 1_234_567_890,
                message_template_name: 'quote_ready',
                message_template_language: 'en',
                reason: null,
              },
            },
          ],
        },
      ],
    },
    response: { received: true },
  },
  'webhooks.leadgen': {
    request: {
      object: 'page',
      entry: [
        {
          id: '104000000000001',
          time: 1_790_500_000,
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: '444444444444',
                form_id: '555555555555',
                page_id: '104000000000001',
                ad_id: '666666666666',
                adgroup_id: '777777777777',
                created_time: 1_790_499_990,
              },
            },
          ],
        },
      ],
    },
    response: { received: true },
  },
  'webhooks.google': {
    request: {
      lead_id: 'lead-form-0001',
      api_version: '1.0',
      form_id: 40_000_000_001,
      campaign_id: 20_000_000_001,
      adgroup_id: 30_000_000_001,
      creative_id: 50_000_000_001,
      gcl_id: 'gclid-0001',
      google_key: 'k'.repeat(24),
      is_test: false,
      user_column_data: [
        { column_id: 'FULL_NAME', column_name: 'Full Name', string_value: 'Suresh Jakhar' },
        { column_id: 'PHONE_NUMBER', column_name: 'User Phone', string_value: '+919000000023' },
        { column_id: 'POSTAL_CODE', column_name: 'Postal Code', string_value: '331001' },
      ],
    },
    response: { received: true },
  },
  'webhooks.exotel.status': {
    request: {
      CallSid: 'b6cfaf0e-exotel-call-0001',
      EventType: 'terminal',
      Status: 'completed',
      Direction: 'outbound-api',
      From: '09000000017',
      To: '08000000160',
      DateCreated: '2026-09-27 10:31:02',
      DateUpdated: '2026-09-27 10:35:40',
      StartTime: '2026-09-27 10:31:05',
      EndTime: '2026-09-27 10:35:38',
      ConversationDuration: '251',
      RecordingUrl: 'https://recordings.exotel.com/shaktisupreme/b6cfaf0e-exotel-call-0001.mp3',
      CustomField: '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a11',
      Legs: [
        { Status: 'completed', OnCallDuration: '260' },
        { Status: 'completed', OnCallDuration: '251' },
      ],
    },
    response: { received: true },
  },
  'webhooks.exotel.incoming': {
    request: {
      CallSid: 'b6cfaf0e-exotel-call-0002',
      CallFrom: '09000000023',
      CallTo: '08000000160',
      Direction: 'incoming',
      CallType: 'call-attempt',
      Created: 'Sun, 27 Sep 2026 10:40:12',
      StartTime: '2026-09-27 10:40:12',
      DialWhomNumber: '',
      CurrentTime: '2026-09-27 10:40:13',
      digits: '"1"',
      flow_id: '281122',
    },
    response: { received: true },
  },
  'webhooks.livekit': {
    request: {
      event: 'participant_left',
      id: 'EV_participant-left-0001',
      createdAt: '1790500900',
      room: { sid: 'RM_room-0001', name: IDS.voiceSession, numParticipants: 1 },
      participant: {
        sid: 'PA_person-0001',
        identity: `user:${IDS.user}`,
        state: 'DISCONNECTED',
        kind: 'STANDARD',
        joinedAt: '1790500020',
      },
    },
    response: { received: true },
  },
  'connector.heartbeat': {
    request: {
      connectorVersion: '1.3.2',
      tallyVersion: 'TallyPrime 6.1',
      companies: [
        { name: 'Shakti Supreme 2026-27', lastAlterId: 48214, reachable: true },
        { name: 'Agro Solar Hub 2026-27', lastAlterId: 9312, reachable: true },
      ],
      queueDepth: 0,
    },
    response: {
      serverTime: '2026-09-27T05:06:40.000Z',
      latestVersion: '1.3.2',
      updateAvailable: false,
    },
  },
  'connector.batches': {
    request: {
      company: 'Shakti Supreme 2026-27',
      entityCode: 'SS',
      fromAlterId: 48200,
      maxAlterId: 48220,
      vouchers: [voucher, salesVoucher],
      ledgers: [
        {
          guid: tallyGuid(0x0c11),
          alterId: 48215,
          name: 'Kisan Seva Kendra Bikaner',
          parent: 'Sundry Debtors',
          gstin: '08ABCDE1234F1Z5',
          openingBalance: '0.00',
          closingBalance: '-7000.00',
          asOf: '2026-09-26',
        },
      ],
    },
    response: {
      company: 'Shakti Supreme 2026-27',
      accepted: { vouchersNew: 1, vouchersChanged: 1, vouchersUnchanged: 0, ledgers: 1 },
      lastAlterId: 48220,
    },
  },
  'connector.snapshot': {
    request: {
      company: 'Shakti Supreme 2026-27',
      entityCode: 'SS',
      asOf: '2026-09-26T20:30:00.000Z',
      fromDate: '2026-04-01',
      voucherGuids: [tallyGuid(0x1a2b), tallyGuid(0x1a2c), tallyGuid(0x1a30)],
    },
    response: {
      company: 'Shakti Supreme 2026-27',
      known: 3,
      tombstoned: 1,
      missingOnServer: [],
    },
  },
  'connector.cursor': {
    query: { company: 'Shakti Supreme 2026-27' },
    response: {
      company: 'Shakti Supreme 2026-27',
      lastAlterId: 48220,
      updatedAt: '2026-09-27T05:01:12.000Z',
    },
  },
  'connector.release': {
    response: {
      version: '1.3.2',
      minimumVersion: '1.2.0',
      url: 'https://shaktiprime.com/releases/tally-connector/1.3.2/ShaktiTallyConnector.msi',
      sha256: 'ab'.repeat(32),
      signature: Buffer.alloc(64, 9).toString('base64'),
      publishedAt: '2026-09-20T09:00:00.000Z',
    },
  },
  'workers.outbox.publish': {
    response: { claimed: 12, published: 3, skipped: 9, failed: 0, deadLettered: 0 },
  },
  'workers.imports.commit': {
    request: { jobId: IDS.importJob, entityId: 1, userId: IDS.user },
    response: { jobId: IDS.importJob, state: 'committed', batches: 2, committedRows: 740 },
  },
  'workers.outbox.failed': {
    request: {
      status: 503,
      sourceBody: Buffer.from(JSON.stringify(deliveredEvent)).toString('base64'),
      retried: 3,
      maxRetries: 3,
      sourceMessageId: 'msg_2h3k4l5m6n7p8q9r',
      topicName: 'evt-crm.lead.created',
    },
    response: { eventId: IDS.event, outcome: 'held', lastError: 'worker_failed' },
  },
  'workers.outbox.event': {
    params: { type: 'crm.lead.created' },
    request: deliveredEvent,
    response: { eventId: IDS.event, outcome: 'done' },
  },
  'workers.messaging.send': {
    request: {
      eventId: IDS.eventB,
      entityId: 1,
      message: {
        threadId: IDS.thread,
        kind: 'template',
        templateName: 'quote_sent',
        params: ['SS/QT/2026-27/0231', '15-10-2026'],
        fileId: IDS.pdf,
      },
    },
    response: {
      eventId: IDS.eventB,
      outcome: 'done',
      status: 'sent',
      providerMessageId: `wamid.${'HBgM'.repeat(12)}`,
    },
  },
  'workers.pdf.render': {
    request: {
      eventId: IDS.eventB,
      entityId: 1,
      target: { kind: 'document', documentType: 'quote', documentId: IDS.quote, version: 1 },
    },
    response: { eventId: IDS.eventB, outcome: 'done', fileId: IDS.pdf, pages: 1, bytes: 164_864 },
  },
  'workers.agents.run': {
    params: { agent: 'triage' },
    request: deliveredEvent,
    response: {
      eventId: IDS.event,
      outcome: 'done',
      runId: IDS.agentRun,
      suggested: 1,
      awaitingApproval: 0,
      applied: 0,
      stopped: null,
    },
  },
  'workers.stt.transcribe': {
    request: {
      eventId: IDS.eventB,
      entityId: 1,
      source: { kind: 'call', callId: IDS.call },
      audioFileId: IDS.audio,
      languageHint: 'hinglish',
    },
    response: {
      eventId: IDS.eventB,
      outcome: 'done',
      transcriptFileId: IDS.transcript,
      audioSeconds: 184,
    },
  },
  'workers.embeddings.index': {
    request: {
      eventId: IDS.eventB,
      knowledgeFileId: IDS.knowledgeFile,
      entityId: null,
      sensitivity: 'staff_ai_ok',
    },
    response: { eventId: IDS.eventB, outcome: 'duplicate' },
  },
  'workers.notify': {
    request: {
      id: IDS.eventB,
      sequence: '42',
      type: 'crm.opportunity.assigned',
      entityId: 1,
      aggregateType: 'opportunity',
      aggregateId: IDS.lead,
      payload: {
        ownerId: IDS.user,
        teamId: null,
        lockHours: 48,
        assignedById: IDS.event,
        v: 1,
      },
    },
    response: { eventId: IDS.eventB, outcome: 'done', created: 1, pushed: 1, heldForQuietHours: 0 },
  },
  'admin.integrations': {
    query: { limit: '50' },
    response: {
      generatedAt: '2026-09-27T05:06:40.000Z',
      outbox: {
        byType: [
          {
            type: 'crm.lead.created',
            pending: 2,
            due: 1,
            deadLettered: 1,
            oldestPendingAt: '2026-09-27T05:04:10.000Z',
          },
        ],
        lastPublisherRun: {
          at: '2026-09-27T05:06:00.000Z',
          claimed: 4,
          published: 3,
          skipped: 0,
          failed: 1,
          deadLettered: 0,
        },
      },
      deliveryCheck: {
        probeId: IDS.probe,
        state: 'arrived',
        requestedAt: '2026-09-27T05:05:12.000Z',
        arrivedAt: '2026-09-27T05:05:12.842Z',
        milliseconds: 842,
      },
      webhooks: [
        {
          provider: 'meta_whatsapp',
          received24h: 1412,
          failedSignature24h: 0,
          unprocessed: 3,
          failed: 0,
          lastReceivedAt: '2026-09-27T05:06:31.000Z',
          oldestUnprocessedAt: '2026-09-27T05:06:29.000Z',
        },
      ],
      deadLetters: {
        total: 1,
        items: [
          {
            eventId: IDS.event,
            type: 'crm.lead.created',
            entityId: 1,
            aggregateType: 'opportunity',
            aggregateId: IDS.lead,
            attempts: 10,
            errorCode: 'queue_refused',
            createdAt: '2026-09-27T03:10:02.000Z',
            deadLetteredAt: '2026-09-27T04:02:15.000Z',
          },
        ],
        nextCursor: null,
      },
      connectors: [
        {
          connectorId: IDS.connector,
          entityId: 1,
          company: 'Shakti Supreme 2026-27',
          connectorVersion: '1.3.2',
          updateAvailable: false,
          lastHeartbeatAt: '2026-09-27T05:05:00.000Z',
          lastBatchAt: '2026-09-27T05:01:12.000Z',
          queueDepth: 0,
          silent: false,
        },
      ],
      whatsapp: [
        {
          entityId: 1,
          channelId: IDS.channel,
          quality: 'green',
          messagingTier: 'tier_1k',
          templatesPending: 1,
          templatesRejected: 0,
          updatedAt: '2026-09-26T11:40:00.000Z',
        },
      ],
      aiSpend: {
        today: '412.50',
        monthToDate: '9840.00',
        byAgent: [
          {
            agent: 'triage',
            today: '38.20',
            monthToDate: '910.75',
            dailyCap: '500.00',
            stoppedByCap: false,
          },
        ],
      },
    },
  },
  'admin.integrations.replay': {
    request: { eventId: IDS.event },
    response: { eventId: IDS.event, requeued: true, attempts: 0 },
  },
  health: {
    response: { status: 'ok', time: '2026-09-27T05:06:40.000Z' },
  },
  'health.ready': {
    response: { status: 'ok', time: '2026-09-27T05:06:40.000Z' },
  },
};
