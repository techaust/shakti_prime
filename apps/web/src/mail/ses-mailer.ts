import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { Mailer } from '@shakti/domain';

export interface SesMailerConfig {
  /** The verified sender, `SES_FROM`: an address on the client's domain. */
  from: string;
  region: string;
  /** For tests: a client with fixed credentials; otherwise the standard AWS variables are read. */
  client?: SESv2Client;
}

/**
 * Mail through Amazon SES in Mumbai (ADR 0003, docs/04-architecture.md §7): plain-text messages from
 * the one verified sender, with a reply-to address and files attached when the message has them (a
 * purchase order's PDF). The wording comes from the message catalogue; nothing here adds to it.
 */
export function sesMailer(config: SesMailerConfig): Mailer {
  const client = config.client ?? new SESv2Client({ region: config.region });
  return {
    async send(message) {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: config.from,
          Destination: { ToAddresses: [message.to] },
          ...(message.replyTo === undefined ? {} : { ReplyToAddresses: [message.replyTo] }),
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
              ...(message.attachments === undefined || message.attachments.length === 0
                ? {}
                : {
                    Attachments: message.attachments.map((a) => ({
                      RawContent: a.content,
                      FileName: a.fileName,
                      ContentType: a.contentType,
                      ContentDisposition: 'ATTACHMENT' as const,
                      ContentTransferEncoding: 'BASE64' as const,
                    })),
                  }),
            },
          },
        }),
      );
    },
  };
}
