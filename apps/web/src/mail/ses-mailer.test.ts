import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { sesMailer } from './ses-mailer';

const client = new SESv2Client({
  region: 'ap-south-1',
  credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test secret phrase' },
});
const ses = mockClient(client);

beforeEach(() => {
  ses.reset();
});

describe('the SES mailer', () => {
  it('sends a plain-text message from the verified sender', async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: 'm-1' });
    const mailer = sesMailer({ from: 'no-reply@shakti.example.in', region: 'ap-south-1', client });
    await mailer.send({
      to: 'staff@shakti.example.in',
      subject: 'Set your password',
      text: 'Open this link to set your password.',
    });
    const [call] = ses.commandCalls(SendEmailCommand);
    expect(call?.args[0].input).toEqual({
      FromEmailAddress: 'no-reply@shakti.example.in',
      Destination: { ToAddresses: ['staff@shakti.example.in'] },
      Content: {
        Simple: {
          Subject: { Data: 'Set your password', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Open this link to set your password.', Charset: 'UTF-8' } },
        },
      },
    });
  });

  it('sends a reply-to address and a PDF attached (a purchase order to its vendor)', async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: 'm-2' });
    const mailer = sesMailer({ from: 'no-reply@shakti.example.in', region: 'ap-south-1', client });
    const content = new Uint8Array([37, 80, 68, 70]);
    await mailer.send({
      to: 'sales@vendor.example.in',
      subject: 'Purchase order',
      text: 'Our purchase order is attached.',
      replyTo: 'buyer@shakti.example.in',
      attachments: [{ fileName: 'Purchase order 7.pdf', contentType: 'application/pdf', content }],
    });
    const [call] = ses.commandCalls(SendEmailCommand);
    expect(call?.args[0].input).toMatchObject({
      ReplyToAddresses: ['buyer@shakti.example.in'],
      Content: {
        Simple: {
          Attachments: [
            {
              RawContent: content,
              FileName: 'Purchase order 7.pdf',
              ContentType: 'application/pdf',
              ContentDisposition: 'ATTACHMENT',
              ContentTransferEncoding: 'BASE64',
            },
          ],
        },
      },
    });
  });

  it('passes a refusal on, so the caller can log it', async () => {
    ses.on(SendEmailCommand).rejects(new Error('MessageRejected'));
    const mailer = sesMailer({ from: 'no-reply@shakti.example.in', region: 'ap-south-1', client });
    await expect(mailer.send({ to: 'a@b.in', subject: 's', text: 't' })).rejects.toThrow(
      'MessageRejected',
    );
  });
});
