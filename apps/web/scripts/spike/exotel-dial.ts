// The Exotel spike (ROADMAP §2 week 6, docs/spikes/exotel.md): one click-to-dial call from the
// entity's DLT number between two phones the user holds, through the same wrapper and calling
// rules the dial command will use, then the call's final state read back from Exotel.
// It rings real phones and costs call minutes, so it runs only when every variable is set, and
// `--dry-run` checks the calling rules without dialling.
// Usage: pnpm --filter web spike:exotel [-- --dry-run]
import { newId } from '@shakti/contracts';
import { checkDial, type CallPurpose } from '@shakti/domain';
import { exotelClient, exotelConfig } from '../../src/integrations/exotel/client';
import { signedStatusCallbackUrl } from '../../src/integrations/exotel/status-callback';

const REQUIRED = [
  'EXOTEL_ACCOUNT_SID',
  'EXOTEL_API_KEY',
  'EXOTEL_API_TOKEN',
  'EXOTEL_CALLBACK_SECRET',
  'EXOTEL_SPIKE_AGENT_NUMBER',
  'EXOTEL_SPIKE_CUSTOMER_NUMBER',
  'EXOTEL_SPIKE_CALLER_ID',
  'EXOTEL_SPIKE_PURPOSE',
  'EXOTEL_SPIKE_CALLBACK_BASE',
] as const;

const TERMINAL = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled']);
const POLL_MS = 5_000;
const POLL_LIMIT = 60;

if (process.env.CI !== undefined && process.env.CI !== '') {
  console.error('the Exotel spike places a real call and never runs in CI');
  process.exit(1);
}
const missing = REQUIRED.filter((name) => (process.env[name] ?? '') === '');
const config = exotelConfig();
if (missing.length > 0 || config === undefined) {
  console.error(`set ${missing.join(', ')} first (docs/spikes/exotel.md)`);
  process.exit(1);
}

const env = (name: (typeof REQUIRED)[number]) => process.env[name] ?? '';
const purposeRaw = env('EXOTEL_SPIKE_PURPOSE');
if (purposeRaw !== 'promotional' && purposeRaw !== 'service') {
  console.error('EXOTEL_SPIKE_PURPOSE is promotional or service');
  process.exit(1);
}
const purpose: CallPurpose = purposeRaw;
const hasRecordedConsent = process.env.EXOTEL_SPIKE_CONSENT === 'yes';
const onDnd = process.env.EXOTEL_SPIKE_ON_DND === 'yes';
const now = new Date();
const ref = newId();

const decision = checkDial({
  at: now,
  purpose,
  callerId: env('EXOTEL_SPIKE_CALLER_ID'),
  to: env('EXOTEL_SPIKE_CUSTOMER_NUMBER'),
  hasRecordedConsent,
  onDnd,
});
console.error(`calling rules: ${decision.allowed ? 'allowed' : decision.refusals.join(', ')}`);
if (!decision.allowed || process.argv.includes('--dry-run')) {
  process.exit(decision.allowed ? 0 : 1);
}

const client = exotelClient(config);
const statusCallbackUrl = signedStatusCallbackUrl(
  env('EXOTEL_SPIKE_CALLBACK_BASE'),
  ref,
  env('EXOTEL_CALLBACK_SECRET'),
  now,
);

const started = performance.now();
const call = await client.connectCall({
  agentNumber: env('EXOTEL_SPIKE_AGENT_NUMBER'),
  customerNumber: env('EXOTEL_SPIKE_CUSTOMER_NUMBER'),
  callerId: env('EXOTEL_SPIKE_CALLER_ID'),
  purpose,
  hasRecordedConsent,
  onDnd,
  statusCallbackUrl,
  record: true,
  timeLimitSeconds: 300,
  customField: ref,
});
const dialMs = performance.now() - started;
console.error(`dial accepted in ${dialMs.toFixed(0)} ms: sid ${call.sid}, status ${call.status}`);
console.error('answer the first phone, then the second; hang up after the recording notice');

let status = call.status;
for (let i = 0; i < POLL_LIMIT && !TERMINAL.has(status); i += 1) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  status = (await client.getCall(call.sid)).status;
  console.error(`status ${status}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      at: now.toISOString(),
      ref,
      sid: call.sid,
      purpose,
      dialAcceptedMs: Math.round(dialMs),
      finalStatus: status,
      callbackAddressBase: env('EXOTEL_SPIKE_CALLBACK_BASE'),
    },
    null,
    2,
  )}\n`,
);
