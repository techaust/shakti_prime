'use client';

import type {
  CommissionRuleRowDto,
  ReferralPartnerCursor,
  ReferralPartnerRowDto,
} from '@shakti/contracts';
import {
  Button,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  toast,
  useFocusTargets,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import {
  listCommissionRules,
  listReferralPartners,
  setCommissionRule,
  setReferralPartner,
} from '../../actions/crm-settings';
import { COMMISSION_BASES } from '../../screens/contract-values';
import { formatDate, formatRupees } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

/**
 * Referral partners and their commission (CRM-09, workshop CRM-5): each referral-partner customer
 * with its code, given or changed in a dialog (`crm.referral_partner.set`), a page of partners at
 * a time; then the commission rules, with a form that adds one from a date
 * (`crm.commission_rule.set`).
 */
export function ReferralsEditor({
  initialPartners,
  initialCursor,
  initialCoded,
  initialRules,
}: {
  initialPartners: ReferralPartnerRowDto[];
  initialCursor: ReferralPartnerCursor | null;
  /** Every partner with a code, whatever page of the list is shown: the commission form's choice. */
  initialCoded: ReferralPartnerRowDto[];
  initialRules: CommissionRuleRowDto[];
}) {
  const [partners, setPartners] = useState(initialPartners);
  const [coded, setCoded] = useState(initialCoded);
  const [cursor, setCursor] = useState(initialCursor);
  const more = useQuery<{
    partners: ReferralPartnerRowDto[];
    nextCursor: ReferralPartnerCursor | null;
  }>();
  return (
    <div className="flex flex-col gap-6">
      <PartnerList
        partners={partners}
        loadingMore={more.pending}
        onSaved={(saved) => {
          setPartners((all) => all.map((p) => (p.accountId === saved.accountId ? saved : p)));
          // A partner given its first code joins the commission form's choice, in name order.
          setCoded((all) =>
            [...all.filter((p) => p.accountId !== saved.accountId), saved].sort(
              (a, b) => a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId),
            ),
          );
        }}
        onMore={
          cursor === null
            ? undefined
            : () => {
                more.load(
                  () => listReferralPartners({ cursor }),
                  (page) => {
                    setPartners((all) => [...all, ...page.partners]);
                    setCursor(page.nextCursor);
                  },
                );
              }
        }
      />
      <FailureMessage failure={more.failure} />
      <CommissionRules coded={coded} initial={initialRules} />
    </div>
  );
}

function PartnerList({
  partners,
  loadingMore,
  onSaved,
  onMore,
}: {
  partners: ReferralPartnerRowDto[];
  loadingMore: boolean;
  onSaved: (partner: ReferralPartnerRowDto) => void;
  onMore: (() => void) | undefined;
}) {
  const t = useTranslations('pipelineSettings');
  const common = useTranslations('common');
  const [editing, setEditing] = useState<ReferralPartnerRowDto | undefined>();
  const buttons = useFocusTargets<string>();
  if (partners.length === 0) return <EmptyState message={t('partnersEmpty')} />;
  return (
    <>
      <ul
        aria-label={t('partners')}
        aria-busy={loadingMore || undefined}
        className="border-border bg-surface divide-border flex flex-col divide-y rounded-xl border"
      >
        {partners.map((p) => (
          <li
            key={p.accountId}
            className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-medium">{p.name}</span>
              <span className="text-text-muted text-sm">
                {p.code === null ? t('codeNone') : t('codeIs', { code: p.code })}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {p.code === null ? null : (
                <StatusBadge tone={p.isActive ? 'success' : 'neutral'}>
                  {p.isActive ? t('codeAccepted') : t('codeStopped')}
                </StatusBadge>
              )}
              <Button
                ref={buttons.ref(p.accountId)}
                type="button"
                variant="secondary"
                aria-label={t('setCodeLabel', { name: p.name })}
                onClick={() => {
                  setEditing(p);
                }}
              >
                {t('setCode')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {onMore === undefined ? null : (
        <div>
          <Button type="button" variant="secondary" pending={loadingMore} onClick={onMore}>
            {t('morePartners')}
          </Button>
        </div>
      )}
      {editing === undefined ? null : (
        <CodeDialog
          partner={editing}
          closeLabel={common('close')}
          returnFocusTo={() => [buttons.get(editing.accountId)]}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={(saved) => {
            onSaved(saved);
            setEditing(undefined);
            toast.success(t('codeSaved', { name: saved.name }));
          }}
        />
      )}
    </>
  );
}

/** Gives a partner its code, changes it, or stops it being accepted on new leads. */
function CodeDialog({
  partner,
  closeLabel,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  partner: ReferralPartnerRowDto;
  closeLabel: string;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: (partner: ReferralPartnerRowDto) => void;
}) {
  const t = useTranslations('pipelineSettings');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setReferralPartner);
  const { fieldError, formFailure } = useFieldFailure(failure, ['code']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    run(
      {
        accountId: partner.accountId,
        code: formText(data, 'code'),
        isActive: data.get('isActive') === 'yes',
      },
      (saved) => {
        onSaved({ ...partner, code: saved.code, isActive: saved.isActive });
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('codeDialogTitle')}</DialogTitle>
            <DialogDescription>{t('codeDialogIntro', { name: partner.name })}</DialogDescription>
          </DialogHeader>
          <Field
            id={`${partner.accountId}-code`}
            label={t('codeLabel')}
            helper={t('codeHelper')}
            error={fieldError('code')}
          >
            <Input
              name="code"
              defaultValue={partner.code ?? ''}
              required
              minLength={4}
              maxLength={12}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </Field>
          <label className="flex min-h-8 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              value="yes"
              defaultChecked={partner.code === null || partner.isActive}
              className="accent-accent size-4 shrink-0 cursor-pointer"
            />
            {t('codeActive')}
          </label>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('saveCode')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const RULE_FIELDS = ['partnerId', 'basis', 'amount', 'effectiveFrom', 'effectiveTo'] as const;

/** The live commission rules, and a form that adds one from a date. */
function CommissionRules({
  coded,
  initial,
}: {
  coded: ReferralPartnerRowDto[];
  initial: CommissionRuleRowDto[];
}) {
  const t = useTranslations('pipelineSettings');
  const basisName = useTranslations('pipelineSettings.basis');
  const [rules, setRules] = useState(initial);
  const [formKey, setFormKey] = useState(0);
  const [from, setFrom] = useState<{ iso: string | undefined; text: string }>({
    iso: undefined,
    text: '',
  });
  const [to, setTo] = useState<{ iso: string | undefined; text: string }>({
    iso: undefined,
    text: '',
  });
  const reload = useQuery<CommissionRuleRowDto[]>();
  const save = useCommand(setCommissionRule);
  const { fieldError, formFailure } = useFieldFailure(save.failure, RULE_FIELDS);
  const fromInvalid = from.text !== '' && from.iso === undefined;
  const toInvalid = to.text !== '' && to.iso === undefined;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.pending || fromInvalid || toInvalid) return;
    const data = new FormData(e.currentTarget);
    const partnerId = formText(data, 'partnerId');
    save.run(
      {
        partnerId: partnerId === '' ? null : partnerId,
        basis: formText(data, 'basis'),
        amount: formText(data, 'amount'),
        effectiveFrom: from.iso ?? '',
        ...(to.iso === undefined ? {} : { effectiveTo: to.iso }),
      },
      () => {
        toast.success(t('commissionSaved'));
        setFormKey((k) => k + 1);
        setFrom({ iso: undefined, text: '' });
        setTo({ iso: undefined, text: '' });
        reload.load(() => listCommissionRules(), setRules);
      },
    );
  }

  return (
    <section aria-labelledby="commission-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 id="commission-heading" className="text-h3">
          {t('commission')}
        </h3>
        <p className="text-text-muted">{t('commissionIntro')}</p>
      </div>
      {rules.length === 0 ? (
        <EmptyState message={t('commissionEmpty')} />
      ) : (
        <ul
          aria-label={t('commission')}
          aria-busy={reload.pending || undefined}
          className="border-border bg-surface divide-border flex flex-col divide-y rounded-xl border"
        >
          {rules.map((r) => (
            <li key={r.id} className="grid gap-1 p-3 sm:grid-cols-3 sm:items-center sm:p-4">
              <span className="font-medium">
                {r.partnerId === null ? t('defaultPartner') : (r.partnerName ?? t('partnerHidden'))}
              </span>
              <span>
                {basisName(r.basis)}:{' '}
                {r.basis === 'percent'
                  ? t('percentValue', { value: r.amount })
                  : formatRupees(r.amount)}
              </span>
              <span className="text-text-muted text-sm">
                {r.effectiveTo === null
                  ? t('datesFrom', { from: formatDate(r.effectiveFrom) })
                  : t('datesBetween', {
                      from: formatDate(r.effectiveFrom),
                      to: formatDate(r.effectiveTo),
                    })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <FailureMessage failure={reload.failure} />
      <form
        key={formKey}
        onSubmit={submit}
        noValidate
        className="border-border bg-surface grid gap-4 rounded-xl border p-4 sm:grid-cols-2 sm:p-5"
      >
        <Field id="commission-partner" label={t('rulePartner')} error={fieldError('partnerId')}>
          <Select name="partnerId" defaultValue="">
            <option value="">{t('defaultPartner')}</option>
            {coded.map((p) => (
              <option key={p.accountId} value={p.accountId}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="commission-basis" label={t('ruleBasis')} error={fieldError('basis')}>
          <Select name="basis" defaultValue="fixed">
            {COMMISSION_BASES.map((b) => (
              <option key={b} value={b}>
                {basisName(b)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="commission-amount"
          label={t('ruleAmount')}
          helper={t('ruleAmountHelper')}
          error={fieldError('amount')}
        >
          <Input name="amount" inputMode="decimal" autoComplete="off" maxLength={15} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="commission-from"
            label={t('ruleFrom')}
            helper={t('dateHelper')}
            error={fromInvalid ? t('dateInvalid') : fieldError('effectiveFrom')}
          >
            <DateInput
              onValueChange={(iso, text) => {
                setFrom({ iso, text });
              }}
              required
            />
          </Field>
          <Field
            id="commission-to"
            label={t('ruleUntil')}
            helper={t('ruleUntilHelper')}
            error={toInvalid ? t('dateInvalid') : fieldError('effectiveTo')}
          >
            <DateInput
              onValueChange={(iso, text) => {
                setTo({ iso, text });
              }}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <FailureMessage failure={formFailure} />
          <div>
            <Button type="submit" pending={save.pending}>
              {t('addCommissionRule')}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
