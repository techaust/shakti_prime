'use client';

import type { EntityChannelDto, EntityChannelKind, EntityDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  StatusBadge,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { archiveEntityChannel, listEntityChannels, setEntityChannel } from '../../actions/org';
import { ENTITY_CHANNEL_KINDS } from '../../screens/contract-values';
import { formatPhone } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

/** The calling channels, whose numbers carry a DLT header and must be of their series. */
const CALLING: ReadonlySet<EntityChannelKind> = new Set(['call_promo_140', 'call_service_160']);

/**
 * Settings › Companies › Channels (docs/03-roadmap-appendix/phase2.md §5.2): a company's WhatsApp,
 * 140-series, 160-series, incoming-calls and missed-call numbers, whether each was checked, and
 * plainly when a calling number is not of its series (every call on it is refused). An Executive
 * adds, changes or takes a number out of use; the numbers are the client's, entered here.
 */
export function ChannelsDialog({
  company,
  closeLabel,
  returnFocusTo,
  onClose,
}: {
  company: EntityDto;
  closeLabel: string;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
}) {
  const t = useTranslations('companies.channels');
  const { load, failure: readFailure } = useQuery<EntityChannelDto[]>();
  const [channels, setChannels] = useState<EntityChannelDto[] | undefined>();
  const [editing, setEditing] = useState<EntityChannelKind | undefined>();

  useEffect(() => {
    load(() => listEntityChannels({ entityId: company.id }), setChannels);
  }, [company.id, load]);

  const replace = (saved: EntityChannelDto) => {
    setChannels((all) => [
      ...(all ?? []).filter((c) => c.channel !== saved.channel),
      ...(saved.isActive ? [saved] : []),
    ]);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('title', { name: company.legalName })}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        {channels === undefined ? (
          readFailure === undefined ? (
            <p className="text-text-muted text-sm" role="status">
              {t('loading')}
            </p>
          ) : (
            <FailureMessage failure={readFailure} />
          )
        ) : editing === undefined ? (
          <ChannelList
            company={company}
            channels={channels}
            onEdit={setEditing}
            onArchived={replace}
          />
        ) : (
          <ChannelForm
            company={company}
            kind={editing}
            current={channels.find((c) => c.channel === editing)}
            onSaved={(saved) => {
              replace(saved);
              setEditing(undefined);
            }}
            onCancel={() => {
              setEditing(undefined);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChannelList({
  company,
  channels,
  onEdit,
  onArchived,
}: {
  company: EntityDto;
  channels: readonly EntityChannelDto[];
  onEdit: (kind: EntityChannelKind) => void;
  onArchived: (channel: EntityChannelDto) => void;
}) {
  const t = useTranslations('companies.channels');
  const common = useTranslations('common');
  const archive = useCommand(archiveEntityChannel);
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-border flex flex-col divide-y" aria-label={t('listLabel')}>
        {ENTITY_CHANNEL_KINDS.map((kind) => {
          const channel = channels.find((c) => c.channel === kind);
          return (
            <li key={kind} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold">{t(`kind.${kind}`)}</span>
                {channel === undefined ? (
                  <span className="text-text-muted text-sm">{common('notSet')}</span>
                ) : (
                  <>
                    <span className="tabular-nums">{formatPhone(channel.numberE164)}</span>
                    <span className="flex flex-wrap gap-2">
                      <StatusBadge tone={channel.verifiedAt === null ? 'neutral' : 'success'}>
                        {channel.verifiedAt === null ? t('unverified') : t('verified')}
                      </StatusBadge>
                    </span>
                    {channel.inSeries === false ? (
                      <span className="text-danger text-sm">
                        {t(kind === 'call_service_160' ? 'outOfSeries160' : 'outOfSeries140')}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t(channel === undefined ? 'addLabel' : 'editLabel', {
                    kind: t(`kind.${kind}`),
                  })}
                  onClick={() => {
                    onEdit(kind);
                  }}
                >
                  {channel === undefined ? t('add') : t('edit')}
                </Button>
                {channel === undefined ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    pending={archive.pending}
                    aria-label={t('archiveLabel', { kind: t(`kind.${kind}`) })}
                    onClick={() => {
                      archive.run({ entityId: company.id, channelId: channel.id }, (done) => {
                        onArchived(done);
                        toast.success(t('archived', { kind: t(`kind.${kind}`) }));
                      });
                    }}
                  >
                    {t('archive')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <FailureMessage failure={archive.failure} />
    </div>
  );
}

function ChannelForm({
  company,
  kind,
  current,
  onSaved,
  onCancel,
}: {
  company: EntityDto;
  kind: EntityChannelKind;
  current: EntityChannelDto | undefined;
  onSaved: (channel: EntityChannelDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('companies.channels');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setEntityChannel, `${String(company.id)}:${kind}`);
  const failures = useFieldFailure(failure, ['number', 'providerRef', 'dltHeader']);
  const currentNumber = current?.numberE164 ?? '';
  const [typed, setTyped] = useState(currentNumber);
  // The tick the Executive gave, if any. Until then it shows the number's check, and only while
  // the field still holds that number: a new number starts unchecked (decision 2).
  const [ticked, setTicked] = useState<boolean | undefined>();
  const verified =
    ticked ??
    (current !== undefined && current.verifiedAt !== null && typed.trim() === currentNumber);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const providerRef = formText(data, 'providerRef');
    const dltHeader = formText(data, 'dltHeader');
    run(
      {
        entityId: company.id,
        channel: kind,
        number: formText(data, 'number'),
        providerRef: providerRef === '' ? null : providerRef,
        ...(CALLING.has(kind) ? { dltHeader: dltHeader === '' ? null : dltHeader } : {}),
        verified,
      },
      (saved) => {
        toast.success(t('saved', { kind: t(`kind.${kind}`) }));
        onSaved(saved);
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h3 className="font-semibold">{t(`kind.${kind}`)}</h3>
      <Field
        id="channel-number"
        label={t('number')}
        helper={t(CALLING.has(kind) ? 'numberHelperCalls' : 'numberHelper')}
        error={failures.fieldError('number')}
      >
        <Input
          name="number"
          value={typed}
          onChange={(e) => {
            setTyped(e.currentTarget.value);
          }}
          required
          inputMode="tel"
          maxLength={20}
          autoComplete="off"
        />
      </Field>
      <Field
        id="channel-reference"
        label={t('providerRef')}
        helper={t('providerRefHelper')}
        error={failures.fieldError('providerRef')}
      >
        <Input
          name="providerRef"
          defaultValue={current?.providerRef ?? ''}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      {CALLING.has(kind) ? (
        <Field
          id="channel-header"
          label={t('dltHeader')}
          helper={t('dltHeaderHelper')}
          error={failures.fieldError('dltHeader')}
        >
          <Input
            name="dltHeader"
            defaultValue={current?.dltHeader ?? ''}
            maxLength={40}
            autoComplete="off"
          />
        </Field>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="verified"
          className="accent-accent size-4"
          checked={verified}
          onChange={(e) => {
            setTicked(e.currentTarget.checked);
          }}
        />
        {t('verifiedCheck')}
      </label>
      <FailureMessage failure={failures.formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
