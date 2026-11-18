'use client';

import type {
  PlaybookAudience,
  PlaybookDirectiveDto,
  PlaybookDirectiveType,
} from '@shakti/contracts';
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
  Select,
  Textarea,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { draftDirective, editDirective } from '../../actions/playbook';
import { PLAYBOOK_AUDIENCE_VALUES, PLAYBOOK_TYPE_VALUES } from '../../screens/contract-values';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';
import type { PlaybookCompany } from './playbook-screen';

/**
 * A new rule typed in (`knowledge.playbook.draft`), or a draft's new wording
 * (`knowledge.playbook.edit`): its short name, the rule, its kind and who it is for, and, for a new
 * one, the company it is for (every company only while All companies is chosen).
 */
export function DirectiveFormDialog({
  directive,
  companies,
  allCompanies,
  readsManagement,
  onClose,
  onSaved,
}: {
  directive: PlaybookDirectiveDto | undefined;
  companies: readonly PlaybookCompany[];
  allCompanies: boolean;
  readsManagement: boolean;
  onClose: () => void;
  onSaved: (directive: PlaybookDirectiveDto) => void;
}) {
  const t = useTranslations('playbook');
  const common = useTranslations('common');
  const draft = useCommand(draftDirective);
  const edit = useCommand(editDirective);
  const firstCompany = companies[0]?.id ?? 0;
  const [title, setTitle] = useState(directive?.title ?? '');
  const [text, setText] = useState(directive?.text ?? '');
  const [type, setType] = useState<PlaybookDirectiveType>(directive?.type ?? 'policy');
  const [audience, setAudience] = useState<PlaybookAudience>(directive?.audience ?? 'staff');
  const [forChoice, setForChoice] = useState<number | 'group'>(
    allCompanies ? 'group' : firstCompany,
  );
  const [tried, setTried] = useState(false);
  const audiences = PLAYBOOK_AUDIENCE_VALUES.filter((a) => a !== 'management' || readsManagement);
  const titleMissing = tried && title.trim() === '';
  const textMissing = tried && text.trim() === '';

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (title.trim() === '' || text.trim() === '') return;
    if (directive === undefined) {
      draft.run(
        {
          entityId: forChoice === 'group' ? firstCompany : forChoice,
          wholeGroup: forChoice === 'group',
          type,
          audience,
          title,
          text,
        },
        onSaved,
      );
    } else {
      edit.run(
        {
          entityId: directive.entityId ?? firstCompany,
          directiveId: directive.id,
          type,
          audience,
          title,
          text,
        },
        onSaved,
      );
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <DialogHeader>
          <DialogTitle>
            {directive === undefined ? t('form.newTitle') : t('form.editTitle')}
          </DialogTitle>
          <DialogDescription>{t('form.intro')}</DialogDescription>
        </DialogHeader>
        <form id="directive-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Field
            id="directive-title"
            label={t('form.titleLabel')}
            error={titleMissing ? t('form.titleMissing') : undefined}
          >
            <Input
              value={title}
              maxLength={120}
              required
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </Field>
          <Field
            id="directive-text"
            label={t('form.textLabel')}
            error={textMissing ? t('form.textMissing') : undefined}
          >
            <Textarea
              value={text}
              maxLength={2000}
              rows={5}
              required
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="directive-type" label={t('form.typeLabel')}>
              <Select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as PlaybookDirectiveType);
                }}
              >
                {PLAYBOOK_TYPE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {t(`type.${v}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="directive-audience"
              label={t('form.audienceLabel')}
              helper={t('form.audienceHint')}
            >
              <Select
                value={audience}
                onChange={(e) => {
                  setAudience(e.target.value as PlaybookAudience);
                }}
              >
                {audiences.map((v) => (
                  <option key={v} value={v}>
                    {t(`audience.${v}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {directive !== undefined ? null : (
            <Field id="directive-for" label={t('form.forLabel')}>
              <Select
                value={String(forChoice)}
                onChange={(e) => {
                  setForChoice(e.target.value === 'group' ? 'group' : Number(e.target.value));
                }}
              >
                {allCompanies ? <option value="group">{t('form.everyCompany')}</option> : null}
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form>
        <FailureMessage failure={draft.failure ?? edit.failure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button type="submit" form="directive-form" pending={draft.pending || edit.pending}>
            {t('form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
