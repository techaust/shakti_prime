// The WhatsApp spike (ROADMAP §2 week 6, docs/04-architecture-appendix/whatsapp.md), against Meta's test number:
//   send     one template (Meta's `hello_world` unless WHATSAPP_SPIKE_TEMPLATE names another) and,
//            when WHATSAPP_SPIKE_TEXT is set, one text inside the 24-hour window, timing each;
//   listen   a local receiver on WHATSAPP_SPIKE_PORT that answers Meta's handshake, checks
//            X-Hub-Signature-256 and prints the ids and states of what arrives (never a body).
//            Expose it with a tunnel the user runs and register that address in the Meta app.
// It talks to Meta with real keys, so it runs only when its variables are set, never in CI.
// Usage: pnpm --filter web spike:whatsapp -- send | listen
import { createServer } from 'node:http';
import { whatsappClient, whatsappConfig } from '../../src/integrations/whatsapp/client';
import {
  parseWhatsAppWebhook,
  verifyHandshake,
  verifyHubSignature,
} from '../../src/integrations/whatsapp/webhook';

if (process.env.CI !== undefined && process.env.CI !== '') {
  console.error('the WhatsApp spike talks to Meta and never runs in CI');
  process.exit(1);
}
const mode = process.argv.slice(2).find((a) => a === 'send' || a === 'listen');

if (mode === 'send') {
  const config = whatsappConfig();
  const to = process.env.WHATSAPP_SPIKE_TO ?? '';
  if (config === undefined || to === '') {
    console.error(
      'set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and WHATSAPP_SPIKE_TO first (docs/04-architecture-appendix/whatsapp.md)',
    );
    process.exit(1);
  }
  const client = whatsappClient(config);
  const template = process.env.WHATSAPP_SPIKE_TEMPLATE ?? 'hello_world';
  const language = process.env.WHATSAPP_SPIKE_TEMPLATE_LANGUAGE ?? 'en_US';
  const params = (process.env.WHATSAPP_SPIKE_TEMPLATE_PARAMS ?? '')
    .split('|')
    .filter((p) => p !== '');

  const t0 = performance.now();
  const sent = await client.sendTemplate({
    to,
    templateName: template,
    languageCode: language,
    bodyParameters: params,
  });
  const templateMs = performance.now() - t0;
  console.error(`template ${template} accepted in ${templateMs.toFixed(0)} ms: ${sent.messageId}`);

  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    template: { name: template, messageId: sent.messageId, acceptedMs: Math.round(templateMs) },
  };
  const text = process.env.WHATSAPP_SPIKE_TEXT ?? '';
  if (text !== '') {
    const t1 = performance.now();
    const textSent = await client.sendText({ to, body: text });
    report.text = { messageId: textSent.messageId, acceptedMs: Math.round(performance.now() - t1) };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (mode === 'listen') {
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
  const port = Number(process.env.WHATSAPP_SPIKE_PORT ?? '8787');
  if (appSecret === '' || verifyToken === '') {
    console.error(
      'set WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN first (docs/04-architecture-appendix/whatsapp.md)',
    );
    process.exit(1);
  }
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${String(port)}`);
    if (req.method === 'GET') {
      const handshake = verifyHandshake(url.searchParams, verifyToken);
      console.error(`handshake ${handshake.ok ? 'answered' : 'refused'}`);
      res.writeHead(handshake.ok ? 200 : 403, { 'content-type': 'text/plain' });
      res.end(handshake.ok ? handshake.challenge : '');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const header = req.headers['x-hub-signature-256'];
      const signed = verifyHubSignature(raw, typeof header === 'string' ? header : null, appSecret);
      if (!signed) {
        console.error('delivery refused: bad signature');
        res.writeHead(401).end();
        return;
      }
      // Meta wants a 200 within seconds; the real route stores the body and answers at once.
      res.writeHead(200).end();
      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        console.error('delivery signed but not JSON');
        return;
      }
      const events = parseWhatsAppWebhook(body);
      if (!events.valid) console.error('delivery signed but not the shape the contract accepts');
      for (const m of events.messages) console.error(`message ${m.id} type ${m.type}`);
      for (const s of events.statuses) {
        console.error(`status ${s.messageId} ${s.status} ${s.errorCodes.join(',')}`);
      }
      for (const t of events.templates) console.error(`template ${t.templateName} ${t.event}`);
    });
  }).listen(port, () => {
    console.error(`listening on http://localhost:${String(port)}; expose it with your tunnel`);
  });
} else {
  console.error('say send or listen: pnpm --filter web spike:whatsapp -- send');
  process.exit(1);
}
