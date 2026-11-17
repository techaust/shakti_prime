'use client';

import type { QuoteDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { quoteSendOptions, sendQuote } from '../../actions/quotes';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import { useCommand } from '../screens/use-command';

/** Why WhatsApp cannot take the quote now, each with its sentence in `quotes.send.reasons`. */
const REASONS = [
  'whatsapp_quote_no_chat',
  'whatsapp_opted_out',
  'whatsapp_quote_no_consent',
  'whatsapp_quote_template_missing',
  'whatsapp_unavailable',
  'not_checked',
] as const;
type Reason = (typeof REASONS)[number];

type WhatsAppState = 'checking' | 'ready' | Reason;

function stateOf(answer: string): WhatsAppState {
  if (answer === 'ready') return 'ready';
  return (REASONS as readonly string[]).includes(answer) ? (answer as Reason) : 'not_checked';
}

/**
 * How a quote is sent (docs/03-roadmap-appendix/phase2.md §7.1): by the company's WhatsApp number,
 * with its document and an Accept button, or handed over by the person and recorded. WhatsApp is
 * offered only when the customer's chat, consent and the company's approved template allow it,
 * and otherwise shown off with the plain reason; recorded is always there.
 */
export function SendDialog({
  quote,
  closeLabel,
  onCancel,
  onDone,
}: {
  quote: QuoteDto;
  closeLabel: string;
  onCancel: () => void;
  onDone: (sent: QuoteDto, channel: 'recorded' | 'whatsapp') => void;
}) {
  const t = useTranslations('quotes.send');
  const common = useTranslations('common');
  const [channel, setChannel] = useState<'recorded' | 'whatsapp'>('recorded');
  const [whatsapp, setWhatsapp] = useState<WhatsAppState>('checking');
  const { run, pending, failure } = useCommand(sendQuote);

  useEffect(() => {
    let current = true;
    void settle(() => quoteSendOptions({ entityId: quote.entityId, quoteId: quote.id })).then(
      (result) => {
        if (current) setWhatsapp(result.ok ? stateOf(result.data.whatsapp) : 'not_checked');
      },
    );
    return () => {
      current = false;
    };
  }, [quote.entityId, quote.id]);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const how = channel === 'whatsapp' && whatsapp === 'ready' ? 'whatsapp' : 'recorded';
    run({ entityId: quote.entityId, quoteId: quote.id, channel: how }, (sent) => {
      onDone(sent, how);
    });
  }

  const whatsappNote =
    whatsapp === 'checking'
      ? t('checking')
      : whatsapp === 'ready'
        ? t('whatsappHelper')
        : t(`reasons.${whatsapp}`);

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent closeLabel={closeLabel}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('intro', { number: quote.quoteNo })}</DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 font-medium">{t('how')}</legend>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="channel"
                  value="whatsapp"
                  className="accent-accent size-4"
                  checked={channel === 'whatsapp'}
                  disabled={whatsapp !== 'ready'}
                  aria-describedby="send-whatsapp-note"
                  onChange={() => {
                    setChannel('whatsapp');
                  }}
                />
                {t('whatsapp')}
              </label>
              <p
                id="send-whatsapp-note"
                role={whatsapp === 'checking' ? 'status' : undefined}
                className="text-text-muted ps-6 text-sm"
              >
                {whatsappNote}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="channel"
                  value="recorded"
                  className="accent-accent size-4"
                  checked={channel === 'recorded'}
                  aria-describedby="send-recorded-note"
                  onChange={() => {
                    setChannel('recorded');
                  }}
                />
                {t('recorded')}
              </label>
              <p id="send-recorded-note" className="text-text-muted ps-6 text-sm">
                {t('recordedHelper')}
              </p>
            </div>
          </fieldset>
          <FailureMessage failure={failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {channel === 'whatsapp' ? t('submitWhatsApp') : t('submitRecord')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
