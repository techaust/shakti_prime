'use client';

import type { Account360Dto, CustomerTaskDto } from '@shakti/contracts';
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
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  addNote,
  archiveTag,
  createTag,
  createTask,
  recordConsent,
  rescheduleTask,
  tagLead,
  updateAccount,
  updateContact,
  upsertSite,
  withdrawConsent,
} from '../../actions/crm';
import {
  ACCOUNT_TYPES,
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  CUSTOMER_LANGUAGES,
  SITE_TYPES,
  TASK_KINDS,
} from '../../screens/contract-values';
import { dueFromLocal, localFromIso } from '../../screens/customers';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/** Which dialog Account 360 shows, with what it is about. */
export type CustomerDialogKind =
  | { kind: 'account' }
  | { kind: 'contact'; contactId: string }
  | { kind: 'site'; siteId?: string }
  | { kind: 'consent' }
  | { kind: 'withdraw'; consentId: string }
  | { kind: 'tag'; opportunityId: string }
  | { kind: 'task' }
  | { kind: 'reschedule'; task: CustomerTaskDto }
  | { kind: 'note' };

interface FormProps {
  view: Account360Dto;
  onDone: () => void;
  onCancel: () => void;
}

/** Text typed into a field, or null when it was left empty. */
function orNull(data: FormData, name: string): string | null {
  const value = formText(data, name);
  return value === '' ? null : value;
}

/**
 * The dialogs of Account 360, loaded on first use. Each form carries its own idempotency key
 * (`useCommand`), so a double press changes the customer once; closing it changes nothing.
 */
export function CustomerDialog({
  dialog,
  view,
  onDone,
  onCancel,
}: FormProps & { dialog: CustomerDialogKind }) {
  const common = useTranslations('common');
  const props = { view, onDone, onCancel };
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        {dialog.kind === 'account' ? (
          <AccountForm {...props} />
        ) : dialog.kind === 'contact' ? (
          <ContactForm {...props} contactId={dialog.contactId} />
        ) : dialog.kind === 'site' ? (
          <SiteForm {...props} siteId={dialog.siteId} />
        ) : dialog.kind === 'consent' ? (
          <ConsentForm {...props} />
        ) : dialog.kind === 'withdraw' ? (
          <WithdrawForm {...props} consentId={dialog.consentId} />
        ) : dialog.kind === 'tag' ? (
          <TagForm {...props} opportunityId={dialog.opportunityId} />
        ) : dialog.kind === 'task' ? (
          <TaskForm {...props} />
        ) : dialog.kind === 'reschedule' ? (
          <RescheduleForm {...props} task={dialog.task} />
        ) : (
          <NoteForm {...props} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Header({ title, intro }: { title: string; intro?: string | undefined }) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      {intro === undefined ? null : <DialogDescription>{intro}</DialogDescription>}
    </DialogHeader>
  );
}

function Footer({
  onCancel,
  pending,
  danger = false,
  children,
}: {
  onCancel: () => void;
  pending: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const common = useTranslations('common');
  return (
    <DialogFooter>
      <Button variant="secondary" onClick={onCancel}>
        {common('cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} pending={pending}>
        {children}
      </Button>
    </DialogFooter>
  );
}

const FORM = 'flex flex-col gap-4';

function AccountForm({ view, onDone, onCancel }: FormProps) {
  const t = useTranslations('customers.dialogs');
  const leadsT = useTranslations('leads');
  const { run, pending, failure } = useCommand(updateAccount);
  const fields = ['name', 'type', 'gstin', 'billingStateCode'];
  const { fieldError, formFailure } = useFieldFailure(failure, fields);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    run(
      {
        entityId: view.entityId,
        accountId: view.account.id,
        name: formText(data, 'name'),
        type: formText(data, 'type'),
        gstin: orNull(data, 'gstin'),
        billingStateCode: orNull(data, 'billingStateCode'),
      },
      onDone,
    );
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={t('accountTitle')} intro={t('accountIntro')} />
      <Field id="account-name" label={t('name')} error={fieldError('name')}>
        <Input name="name" defaultValue={view.account.name} required maxLength={120} />
      </Field>
      <Field id="account-type" label={t('type')} error={fieldError('type')}>
        <Select name="type" defaultValue={view.account.type}>
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {leadsT(`accountType.${type}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id="account-gstin"
        label={t('gstin')}
        helper={t('gstinHelper')}
        error={fieldError('gstin')}
      >
        <Input
          name="gstin"
          defaultValue={view.account.gstin ?? ''}
          maxLength={15}
          autoCapitalize="characters"
        />
      </Field>
      <Field
        id="account-billing-state"
        label={t('billingState')}
        helper={t('stateHelper')}
        error={fieldError('billingStateCode')}
      >
        <Input
          name="billingStateCode"
          defaultValue={view.account.billingStateCode ?? ''}
          inputMode="numeric"
          maxLength={2}
        />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submitSave')}
      </Footer>
    </form>
  );
}

function ContactForm({ view, onDone, onCancel, contactId }: FormProps & { contactId: string }) {
  const t = useTranslations('customers.dialogs');
  const leadsT = useTranslations('leads');
  const { run, pending, failure } = useCommand(updateContact);
  const fields = ['name', 'email', 'preferredLanguage', 'addPhones'];
  const { fieldError, formFailure } = useFieldFailure(failure, fields);
  const contact = view.contacts.find((c) => c.id === contactId);
  if (contact === undefined) return null;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || contact === undefined) return;
    const data = new FormData(e.currentTarget);
    const newPhone = formText(data, 'newPhone');
    const primary = formText(data, 'primary');
    const remove = data.getAll('remove').filter((v): v is string => typeof v === 'string');
    run(
      {
        entityId: view.entityId,
        accountId: view.account.id,
        contactId: contact.id,
        name: formText(data, 'name'),
        email: orNull(data, 'email'),
        preferredLanguage: formText(data, 'preferredLanguage'),
        ...(newPhone === ''
          ? {}
          : { addPhones: [{ phone: newPhone, isWhatsapp: data.get('newIsWhatsapp') === 'on' }] }),
        ...(primary === '' || remove.includes(primary) ? {} : { primaryPhoneId: primary }),
        ...(remove.length === 0 ? {} : { removePhoneIds: remove }),
      },
      onDone,
    );
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={t('contactTitle', { name: contact.name })} intro={t('contactIntro')} />
      <Field id="contact-name" label={t('contactName')} error={fieldError('name')}>
        <Input name="name" defaultValue={contact.name} required maxLength={120} />
      </Field>
      <Field id="contact-email" label={t('email')} error={fieldError('email')}>
        <Input name="email" type="email" defaultValue={contact.email ?? ''} maxLength={200} />
      </Field>
      <Field id="contact-language" label={t('language')} error={fieldError('preferredLanguage')}>
        <Select name="preferredLanguage" defaultValue={contact.preferredLanguage}>
          {CUSTOMER_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {leadsT(`language.${language}`)}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-text-muted mb-1 text-sm font-medium">{t('numbers')}</legend>
        {contact.phones.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="min-w-32 tabular-nums">{p.e164}</span>
            <label className="inline-flex min-h-8 items-center gap-2 text-sm">
              <input
                type="radio"
                name="primary"
                value={p.id}
                defaultChecked={p.isPrimary}
                className="accent-accent size-4"
              />
              {t('makeMain')}
            </label>
            <label className="inline-flex min-h-8 items-center gap-2 text-sm">
              <input type="checkbox" name="remove" value={p.id} className="accent-accent size-4" />
              {t('removeNumber')}
            </label>
          </div>
        ))}
      </fieldset>
      <Field
        id="contact-new-phone"
        label={t('newNumber')}
        helper={t('newNumberHelper')}
        error={fieldError('addPhones')}
      >
        <Input name="newPhone" type="tel" inputMode="tel" maxLength={20} autoComplete="off" />
      </Field>
      <label className="inline-flex min-h-8 items-center gap-2 text-sm">
        <input type="checkbox" name="newIsWhatsapp" className="accent-accent size-4" />
        {t('newIsWhatsapp')}
      </label>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submitSave')}
      </Footer>
    </form>
  );
}

function SiteForm({ view, onDone, onCancel, siteId }: FormProps & { siteId?: string | undefined }) {
  const t = useTranslations('customers.dialogs');
  const leadsT = useTranslations('leads');
  const { run, pending, failure } = useCommand(upsertSite);
  const fields = ['type', 'address', 'village', 'tehsil', 'district', 'pin', 'stateCode'];
  const { fieldError, formFailure } = useFieldFailure(failure, [...fields, 'location']);
  const site = siteId === undefined ? undefined : view.sites.find((s) => s.id === siteId);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const lat = formText(data, 'lat');
    const lng = formText(data, 'lng');
    const location = lat === '' && lng === '' ? null : { lat: Number(lat), lng: Number(lng) };
    run(
      {
        entityId: view.entityId,
        accountId: view.account.id,
        ...(site === undefined ? {} : { siteId: site.id }),
        type: formText(data, 'type'),
        address: orNull(data, 'address'),
        village: orNull(data, 'village'),
        tehsil: orNull(data, 'tehsil'),
        district: orNull(data, 'district'),
        pin: orNull(data, 'pin'),
        stateCode: orNull(data, 'stateCode'),
        location,
      },
      onDone,
    );
  }

  const text = (name: string, value: string | null | undefined, extra: object = {}) => (
    <Field id={`site-${name}`} label={t(name as 'village')} error={fieldError(name)}>
      <Input name={name} defaultValue={value ?? ''} maxLength={120} {...extra} />
    </Field>
  );

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={site === undefined ? t('siteTitleNew') : t('siteTitleEdit')} />
      <Field id="site-type" label={t('siteType')} error={fieldError('type')}>
        <Select name="type" defaultValue={site?.type ?? SITE_TYPES[0]}>
          {SITE_TYPES.map((type) => (
            <option key={type} value={type}>
              {leadsT(`siteType.${type}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="site-address" label={t('address')} error={fieldError('address')}>
        <Textarea name="address" defaultValue={site?.address ?? ''} maxLength={300} rows={2} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {text('village', site?.village)}
        {text('tehsil', site?.tehsil)}
        {text('district', site?.district)}
        {text('pin', site?.pin, { inputMode: 'numeric', maxLength: 6 })}
        {text('stateCode', site?.stateCode, { inputMode: 'numeric', maxLength: 2 })}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t('locationHelper')}</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field id="site-lat" label={t('lat')} error={fieldError('location')}>
            <Input
              name="lat"
              inputMode="decimal"
              defaultValue={site?.lat === null || site === undefined ? '' : String(site.lat)}
            />
          </Field>
          <Field id="site-lng" label={t('lng')}>
            <Input
              name="lng"
              inputMode="decimal"
              defaultValue={site?.lng === null || site === undefined ? '' : String(site.lng)}
            />
          </Field>
        </div>
        <p className="text-text-muted text-sm">{t('locationHelper')}</p>
      </fieldset>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submitSave')}
      </Footer>
    </form>
  );
}

function ConsentForm({ view, onDone, onCancel }: FormProps) {
  const t = useTranslations('customers.dialogs');
  const c = useTranslations('customers.consent');
  const { run, pending, failure } = useCommand(recordConsent);
  const fields = ['contactId', 'channel', 'purpose', 'source', 'textVersion', 'givenAt'];
  const { fieldError, formFailure } = useFieldFailure(failure, fields);
  const [now] = useState(() => localFromIso(new Date().toISOString()));

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    run(
      {
        entityId: view.entityId,
        accountId: view.account.id,
        contactId: formText(data, 'contactId'),
        channel: formText(data, 'channel'),
        purpose: formText(data, 'purpose'),
        source: formText(data, 'source'),
        textVersion: formText(data, 'textVersion'),
        givenAt: dueFromLocal(formText(data, 'givenAt')) ?? '',
      },
      () => {
        toast.success(t('saved'));
        onDone();
      },
    );
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={t('consentTitle')} intro={t('consentIntro')} />
      <Field id="consent-contact" label={t('consentContact')} error={fieldError('contactId')}>
        <Select name="contactId" defaultValue={view.contacts[0]?.id}>
          {view.contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="consent-channel" label={t('consentChannel')} error={fieldError('channel')}>
          <Select name="channel" defaultValue={CONSENT_CHANNELS[0]}>
            {CONSENT_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {c(`channel.${channel}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="consent-purpose" label={t('consentPurpose')} error={fieldError('purpose')}>
          <Select name="purpose" defaultValue={CONSENT_PURPOSES[0]}>
            {CONSENT_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {c(`purpose.${purpose}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="consent-source" label={t('consentSource')} error={fieldError('source')}>
        <Select name="source" defaultValue="walk_in_form">
          {CONSENT_SOURCES.map((source) => (
            <option key={source} value={source}>
              {c(`source.${source}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id="consent-version"
        label={t('consentVersion')}
        helper={t('consentVersionHelper')}
        error={fieldError('textVersion')}
      >
        <Input name="textVersion" required maxLength={40} autoComplete="off" />
      </Field>
      <Field id="consent-given" label={t('consentGiven')} error={fieldError('givenAt')}>
        <Input name="givenAt" type="datetime-local" defaultValue={now} max={now} />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submitRecord')}
      </Footer>
    </form>
  );
}

function WithdrawForm({ view, onDone, onCancel, consentId }: FormProps & { consentId: string }) {
  const t = useTranslations('customers.dialogs');
  const c = useTranslations('customers.consent');
  const { run, pending, failure } = useCommand(withdrawConsent);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    run({ entityId: view.entityId, accountId: view.account.id, consentId }, () => {
      toast.success(c('withdrawnToast'));
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={t('withdrawTitle')} intro={t('withdrawIntro')} />
      <FailureMessage failure={failure} />
      <Footer onCancel={onCancel} pending={pending} danger>
        {t('submitWithdraw')}
      </Footer>
    </form>
  );
}

function TagForm({ view, onDone, onCancel, opportunityId }: FormProps & { opportunityId: string }) {
  const t = useTranslations('customers.dialogs');
  const put = useCommand(tagLead);
  const make = useCommand(createTag);
  const { fieldError, formFailure } = useFieldFailure(put.failure ?? make.failure, [
    'tagId',
    'name',
  ]);
  const carried = new Set(
    view.leads.find((l) => l.id === opportunityId)?.tags.map((tag) => tag.id) ?? [],
  );
  const choices = view.tags.filter((tag) => !carried.has(tag.id));
  const pending = put.pending || make.pending;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const name = formText(data, 'name');
    const tagId = formText(data, 'tagId');
    const target = { entityId: view.entityId, opportunityId };
    if (name !== '') {
      make.run({ entityId: view.entityId, name }, (tag) => {
        put.run({ ...target, tagId: tag.id }, onDone);
      });
      return;
    }
    if (tagId !== '') put.run({ ...target, tagId }, onDone);
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={t('tagTitle')} intro={t('tagIntro')} />
      {choices.length === 0 ? (
        <p className="text-text-muted">{t('noTags')}</p>
      ) : (
        <Field id="tag-choice" label={t('tag')} error={fieldError('tagId')}>
          <Select name="tagId" defaultValue="">
            <option value="">{t('choose')}</option>
            {choices.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {view.canManageTags ? (
        <Field
          id="tag-new"
          label={t('newTag')}
          helper={t('newTagHelper')}
          error={fieldError('name')}
        >
          <Input name="name" maxLength={40} autoComplete="off" />
        </Field>
      ) : null}
      {view.canManageTags && view.tags.length > 0 ? <TagList view={view} onDone={onDone} /> : null}
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submitAdd')}
      </Footer>
    </form>
  );
}

/**
 * The tags on the list, each with a button that takes it off (`crm.tag.archive`); the leads that
 * carry a tag keep it. Only for someone who may make tags.
 */
function TagList({ view, onDone }: { view: Account360Dto; onDone: () => void }) {
  const t = useTranslations('customers.dialogs');
  const archive = useCommand(archiveTag);
  const [busy, setBusy] = useState<string | undefined>();
  return (
    <section aria-labelledby="tag-list-heading" className="flex flex-col gap-2">
      <h3 id="tag-list-heading" className="text-text-muted text-sm font-medium">
        {t('tagListTitle')}
      </h3>
      <ul className="flex flex-col gap-1">
        {view.tags.map((tag) => (
          <li key={tag.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="break-words">{tag.name}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('archiveTagLabel', { name: tag.name })}
              pending={archive.pending && busy === tag.id}
              onClick={() => {
                setBusy(tag.id);
                archive.run({ tagId: tag.id }, onDone);
              }}
            >
              {t('archiveTag')}
            </Button>
          </li>
        ))}
      </ul>
      <FailureMessage failure={archive.failure} />
    </section>
  );
}

function TaskForm({ view, onDone, onCancel }: FormProps) {
  const t = useTranslations('customers.dialogs');
  const tasks = useTranslations('customers.tasks');
  const { run, pending, failure } = useCommand(createTask);
  const fields = ['opportunityId', 'kind', 'dueAt', 'title'];
  const { fieldError, formFailure } = useFieldFailure(failure, fields);
  const [soon] = useState(() => localFromIso(new Date(Date.now() + 3_600_000).toISOString()));

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const title = formText(data, 'title');
    run(
      {
        entityId: view.entityId,
        opportunityId: formText(data, 'opportunityId'),
        kind: formText(data, 'kind'),
        dueAt: dueFromLocal(formText(data, 'dueAt')) ?? '',
        ...(title === '' ? {} : { title }),
      },
      onDone,
    );
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={t('taskTitle')} intro={t('taskIntro')} />
      <Field id="task-lead" label={t('taskLead')} error={fieldError('opportunityId')}>
        <Select name="opportunityId" defaultValue={view.leads[0]?.id}>
          {view.leads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.pipelineName} · {lead.stageName}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="task-kind" label={t('taskKind')} error={fieldError('kind')}>
        <Select name="kind" defaultValue={TASK_KINDS[0]}>
          {TASK_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {tasks(`kind.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id="task-due"
        label={t('taskDue')}
        helper={t('taskDueHelper')}
        error={fieldError('dueAt')}
      >
        <Input name="dueAt" type="datetime-local" defaultValue={soon} required />
      </Field>
      <Field
        id="task-title"
        label={t('taskNote')}
        helper={t('taskNoteHelper')}
        error={fieldError('title')}
      >
        <Input name="title" maxLength={80} autoComplete="off" />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submitAdd')}
      </Footer>
    </form>
  );
}

function RescheduleForm({ view, onDone, onCancel, task }: FormProps & { task: CustomerTaskDto }) {
  const t = useTranslations('customers.dialogs');
  const { run, pending, failure } = useCommand(rescheduleTask);
  const { fieldError, formFailure } = useFieldFailure(failure, ['dueAt']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    run(
      {
        entityId: view.entityId,
        taskId: task.id,
        dueAt: dueFromLocal(formText(data, 'dueAt')) ?? '',
      },
      onDone,
    );
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={t('rescheduleTitle')} />
      <Field
        id="task-new-due"
        label={t('taskDue')}
        helper={t('taskDueHelper')}
        error={fieldError('dueAt')}
      >
        <Input
          name="dueAt"
          type="datetime-local"
          defaultValue={localFromIso(task.dueAt)}
          required
        />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submitSave')}
      </Footer>
    </form>
  );
}

function NoteForm({ view, onDone, onCancel }: FormProps) {
  const t = useTranslations('customers.dialogs');
  const { run, pending, failure } = useCommand(addNote);
  const { fieldError, formFailure } = useFieldFailure(failure, ['body', 'opportunityId']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const lead = formText(data, 'opportunityId');
    run(
      {
        entityId: view.entityId,
        accountId: view.account.id,
        ...(lead === '' ? {} : { opportunityId: lead }),
        body: formText(data, 'body'),
      },
      onDone,
    );
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <Header title={t('noteTitle')} intro={t('noteIntro')} />
      {view.leads.length === 0 ? null : (
        <Field id="note-lead" label={t('noteLead')} error={fieldError('opportunityId')}>
          <Select name="opportunityId" defaultValue="">
            <option value="">{t('noteWholeCustomer')}</option>
            {view.leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.pipelineName} · {lead.stageName}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field id="note-body" label={t('noteBody')} error={fieldError('body')}>
        <Textarea name="body" required maxLength={2000} rows={5} />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submitAdd')}
      </Footer>
    </form>
  );
}
