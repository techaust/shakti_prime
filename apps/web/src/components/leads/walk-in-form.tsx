'use client';

import type { PipelineDto } from '@shakti/contracts';
import { Button, Field, Input, Select, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createLead } from '../../actions/crm';
import { CUSTOMER_LANGUAGES, pipelinesFor, REFERRAL_CODE_BOX } from '../../screens/lead-form';
import {
  buildWalkInInput,
  WALK_IN_KINDS,
  walkInProblem,
  type WalkInConsent,
} from '../../screens/walk-in';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

const FIELDS = [
  'entityId',
  'pipelineKey',
  'contact.name',
  'contact.phone',
  'account.type',
  'site.village',
  'site.pin',
  'referralCode',
  'consent',
] as const;

/**
 * The walk-in quick form: name, mobile, language for calls, interest, village and PIN, the referral
 * code once lead creation applies it (`REFERRAL_CODE_BOX`) and,
 * once the client's wording exists, the consent tick. Keyboard first: the first box takes focus,
 * Enter saves, and after a save the form clears and the name box takes focus again for the next
 * customer. One idempotency key per customer, so a double press saves one lead.
 */
export function WalkInForm({
  companies,
  pipelines,
  consent,
}: {
  companies: { id: number; name: string }[];
  pipelines: PipelineDto[];
  /** The consent wording shown at the counter, with what it records; undefined until it exists. */
  consent: (WalkInConsent & { text: string }) | undefined;
}) {
  const t = useTranslations('leads.walkIn');
  const leads = useTranslations('leads');
  const { run, pending, failure } = useCommand(createLead);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [entityId, setEntityId] = useState(companies.length === 1 ? companies[0]?.id : undefined);
  const [pipelineKey, setPipelineKey] = useState('');
  const [villageNeeded, setVillageNeeded] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const offered = entityId === undefined ? [] : pipelinesFor(pipelines, entityId);
  const segment = offered.find((p) => p.key === pipelineKey)?.segment;
  const asksPlace = segment === undefined || WALK_IN_KINDS[segment].site !== undefined;

  // The first box takes focus: the company when there is a choice, else the name.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('select, input:not([type="hidden"])')?.focus();
  }, []);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => formText(data, name);
    const place = { village: asksPlace ? text('village') : '', pin: asksPlace ? text('pin') : '' };
    if (walkInProblem(place) === 'villageNeeded') {
      setVillageNeeded(true);
      form.querySelector<HTMLInputElement>('[name="village"]')?.focus();
      return;
    }
    setVillageNeeded(false);
    const name = text('name');
    run(
      buildWalkInInput({
        entityId: text('entityId'),
        pipelineKey,
        segment,
        name,
        phone: text('phone'),
        language: text('language'),
        ...place,
        referralCode: REFERRAL_CODE_BOX ? text('referralCode') : '',
        consent: consent !== undefined && data.get('consent') === 'yes' ? consent : undefined,
      }),
      () => {
        toast.success(t('done', { name }));
        form.reset();
        setPipelineKey('');
        nameRef.current?.focus();
      },
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {companies.length === 1 ? (
        <input type="hidden" name="entityId" value={String(companies[0]?.id ?? '')} />
      ) : (
        <Field id="walk-in-company" label={t('company')} error={fieldError('entityId')}>
          <Select
            name="entityId"
            required
            value={entityId === undefined ? '' : String(entityId)}
            onChange={(e) => {
              const next = Number(e.currentTarget.value);
              setEntityId(Number.isInteger(next) && next > 0 ? next : undefined);
              setPipelineKey('');
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
      <Field id="walk-in-name" label={t('name')} error={fieldError('contact.name')}>
        <Input
          ref={nameRef}
          name="name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="off"
        />
      </Field>
      <Field
        id="walk-in-phone"
        label={t('phone')}
        helper={t('phoneHelper')}
        error={fieldError('contact.phone')}
      >
        <Input name="phone" type="tel" inputMode="tel" required maxLength={20} autoComplete="off" />
      </Field>
      <Field id="walk-in-language" label={t('language')}>
        <Select name="language" defaultValue="hinglish">
          {CUSTOMER_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {leads(`language.${language}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id="walk-in-interest"
        label={t('interest')}
        error={fieldError('pipelineKey') ?? fieldError('account.type')}
      >
        <Select
          name="pipelineKey"
          required
          value={pipelineKey}
          onChange={(e) => {
            setPipelineKey(e.currentTarget.value);
          }}
        >
          <option value="">{t('choose')}</option>
          {offered.map((p) => (
            <option key={p.id} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {asksPlace ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field
            id="walk-in-village"
            label={t('village')}
            helper={t('placeHelper')}
            error={villageNeeded ? t('villageNeeded') : fieldError('site.village')}
          >
            <Input name="village" maxLength={120} autoComplete="off" />
          </Field>
          <Field id="walk-in-pin" label={t('pin')} error={fieldError('site.pin')}>
            <Input name="pin" inputMode="numeric" maxLength={6} autoComplete="postal-code" />
          </Field>
        </div>
      ) : null}
      {REFERRAL_CODE_BOX ? (
        <Field
          id="walk-in-referral"
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
      {consent === undefined ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-text-muted mb-1 text-sm font-medium">{t('consent')}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="consent"
              value="yes"
              className="accent-accent mt-0.5 size-4 shrink-0 cursor-pointer"
            />
            {consent.text}
          </label>
          {fieldError('consent') === undefined ? null : (
            <p className="text-danger text-sm">{fieldError('consent')}</p>
          )}
        </fieldset>
      )}
      <FailureMessage failure={formFailure} />
      <div className="flex justify-end">
        <Button type="submit" pending={pending} className="max-sm:w-full">
          {t('walkInSubmit')}
        </Button>
      </div>
    </form>
  );
}
