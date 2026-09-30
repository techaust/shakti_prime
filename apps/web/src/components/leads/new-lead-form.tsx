'use client';

import type { LeadSourceDto, PipelineDto } from '@shakti/contracts';
import { Button, Field, Input, Select, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { createLead } from '../../actions/crm';
import {
  ACCOUNT_TYPES,
  buildLeadInput,
  CUSTOMER_LANGUAGES,
  pipelinesFor,
  REFERRAL_CODE_BOX,
  SITE_TYPES,
} from '../../screens/lead-form';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

const FIELDS = [
  'entityId',
  'pipelineKey',
  'contact.name',
  'contact.phone',
  'contact.preferredLanguage',
  'account.type',
  'account.name',
  'site.village',
  'site.type',
  'site.pin',
  'sourceCode',
  'referralCode',
] as const;

/**
 * The New lead form: a new customer with their mobile number, the line of business and, when the
 * caller knows it, the site and where the lead came from. One idempotency key per rendered form,
 * so a double press saves one lead.
 */
export function NewLeadForm({
  companies,
  pipelines,
  sources,
}: {
  companies: { id: number; name: string }[];
  pipelines: PipelineDto[];
  sources: LeadSourceDto[];
}) {
  const t = useTranslations('leads.new');
  const leads = useTranslations('leads');
  const router = useRouter();
  const { run, pending, failure } = useCommand(createLead);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [entityId, setEntityId] = useState(companies.length === 1 ? companies[0]?.id : undefined);
  const offered = entityId === undefined ? [] : pipelinesFor(pipelines, entityId);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const text = (name: string) => formText(data, name);
    const name = text('name');
    run(
      buildLeadInput({
        entityId: text('entityId'),
        pipelineKey: text('pipelineKey'),
        name,
        phone: text('phone'),
        accountType: text('accountType'),
        accountName: text('accountName'),
        language: text('language'),
        village: text('village'),
        siteType: text('siteType'),
        pin: text('pin'),
        sourceCode: text('sourceCode'),
        referralCode: text('referralCode'),
      }),
      () => {
        toast.success(t('done', { name }));
        router.push('/leads');
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-4">
        {companies.length === 1 ? (
          <input type="hidden" name="entityId" value={String(companies[0]?.id ?? '')} />
        ) : (
          <Field id="lead-company" label={t('company')} error={fieldError('entityId')}>
            <Select
              name="entityId"
              required
              value={entityId === undefined ? '' : String(entityId)}
              onChange={(e) => {
                const next = Number(e.currentTarget.value);
                setEntityId(Number.isInteger(next) && next > 0 ? next : undefined);
              }}
            >
              <option value="">{t('choose')}</option>
              {companies.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="lead-pipeline" label={t('pipeline')} error={fieldError('pipelineKey')}>
          <Select name="pipelineKey" required defaultValue="" key={entityId ?? 'none'}>
            <option value="">{t('choose')}</option>
            {offered.map((p) => (
              <option key={p.id} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-h3 mb-2">{t('customer')}</legend>
        <Field
          id="lead-name"
          label={t('name')}
          helper={t('nameHelper')}
          error={fieldError('contact.name')}
        >
          <Input name="name" required minLength={2} maxLength={120} autoComplete="off" />
        </Field>
        <Field
          id="lead-phone"
          label={t('phone')}
          helper={t('phoneHelper')}
          error={fieldError('contact.phone')}
        >
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            required
            maxLength={20}
            autoComplete="off"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="lead-account-type" label={t('accountType')} error={fieldError('account.type')}>
            <Select name="accountType" required defaultValue="">
              <option value="">{t('choose')}</option>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {leads(`accountType.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="lead-language"
            label={t('language')}
            error={fieldError('contact.preferredLanguage')}
          >
            <Select name="language" defaultValue="hinglish">
              {CUSTOMER_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {leads(`language.${language}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          id="lead-account-name"
          label={t('accountName')}
          helper={t('accountNameHelper')}
          error={fieldError('account.name')}
        >
          <Input name="accountName" maxLength={120} autoComplete="off" />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-h3 mb-1">{t('site')}</legend>
        <p className="text-text-muted text-sm">{t('siteHelper')}</p>
        <Field id="lead-village" label={t('village')} error={fieldError('site.village')}>
          <Input name="village" maxLength={120} autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="lead-site-type" label={t('siteType')} error={fieldError('site.type')}>
            <Select name="siteType" defaultValue="">
              <option value="">{t('choose')}</option>
              {SITE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {leads(`siteType.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="lead-pin" label={t('pin')} error={fieldError('site.pin')}>
            <Input name="pin" inputMode="numeric" maxLength={6} autoComplete="postal-code" />
          </Field>
        </div>
      </fieldset>

      <Field id="lead-source" label={t('source')} error={fieldError('sourceCode')}>
        <Select name="sourceCode" defaultValue="">
          <option value="">{t('sourceUnknown')}</option>
          {sources.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      {REFERRAL_CODE_BOX ? (
        <Field
          id="lead-referral"
          label={t('referral')}
          helper={t('referralHelper')}
          error={fieldError('referralCode')}
        >
          <Input
            name="referralCode"
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </Field>
      ) : null}

      <FailureMessage failure={formFailure} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" asChild>
          <Link href="/leads">{t('cancel')}</Link>
        </Button>
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
