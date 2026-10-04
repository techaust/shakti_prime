'use client';

import type { InboxDecisionDto, InboxItemDto } from '@shakti/contracts';
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
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { SyntheticEvent } from 'react';
import { editSuggestion } from '../../actions/agents';
import { agentFieldName } from '../../screens/agents';
import { dueFromLocal, localFromIso } from '../../screens/customers';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/**
 * Agent Inbox › Edit: the fields of a suggestion a person may change, then approve with the
 * changes. Loaded on demand by the inbox screen and shown while it is mounted.
 */
export function EditSuggestionDialog({
  item,
  closeLabel,
  returnFocusTo,
  onDecided,
  onClose,
}: {
  item: InboxItemDto;
  closeLabel: string;
  returnFocusTo: ReturnFocusTo;
  onDecided: (decision: InboxDecisionDto) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        <EditSuggestionForm item={item} onDecided={onDecided} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function EditSuggestionForm({
  item,
  onDecided,
  onCancel,
}: {
  item: InboxItemDto;
  onDecided: (decision: InboxDecisionDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('agents');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(editSuggestion);
  const names = item.fields.map((f) => `changes.${f.name}`);
  const { fieldError, formFailure } = useFieldFailure(failure, names);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const changes: Record<string, string> = {};
    for (const field of item.fields) {
      const typed = formText(data, field.name);
      // A time the browser could not read stays as typed; the command refuses it in words.
      changes[field.name] = field.kind === 'date_time' ? (dueFromLocal(typed) ?? typed) : typed;
    }
    run({ entityId: item.entityId, itemId: item.id, changes }, onDecided);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('inbox.editTitle')}</DialogTitle>
        <DialogDescription>{t('inbox.editIntro')}</DialogDescription>
      </DialogHeader>
      {item.fields.map((field) => {
        const name = agentFieldName(field.name);
        const label = name === undefined ? field.name : t(`fields.${name}`);
        const error = fieldError(`changes.${field.name}`);
        return field.kind === 'date_time' ? (
          <Field
            key={field.name}
            id={`suggestion-${field.name}`}
            label={label}
            helper={t('inbox.dueHelper')}
            error={error}
          >
            <Input
              name={field.name}
              type="datetime-local"
              defaultValue={field.value === null ? '' : localFromIso(field.value)}
              required
            />
          </Field>
        ) : (
          <Field
            key={field.name}
            id={`suggestion-${field.name}`}
            label={label}
            helper={t('inbox.titleHelper', { max: field.maxLength ?? 200 })}
            error={error}
          >
            <Input
              name={field.name}
              defaultValue={field.value ?? ''}
              maxLength={field.maxLength ?? 200}
              autoComplete="off"
            />
          </Field>
        );
      })}
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('inbox.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
