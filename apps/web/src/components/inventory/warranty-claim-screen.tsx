'use client';

import type {
  ClaimSerialDto,
  HubDto,
  VendorListRowDto,
  WarrantyClaimCostsDto,
  WarrantyClaimDto,
} from '@shakti/contracts';
import { Button, StatusBadge, type ReturnFocusTo } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { customerHref } from '../../screens/customers';
import { formatDate, formatRupees } from '../../screens/format';
import { serialHref } from '../../screens/inventory';
import { CLAIM_STATE_TONE, claimSteps, warrantyListHref } from '../../screens/warranty';
import { Page } from '../shell/page';
import { useClaimStateText, useSerialStateText } from './use-inventory-text';

// The dialogs load on first use, so the sheet ships only what it shows.
const IdentifyDialog = dynamic(() => import('./warranty-dialogs').then((m) => m.IdentifyDialog));
const RejectDialog = dynamic(() => import('./warranty-dialogs').then((m) => m.RejectDialog));
const SettleDialog = dynamic(() => import('./warranty-dialogs').then((m) => m.SettleDialog));
const ReplaceDialog = dynamic(() => import('./warranty-dialogs').then((m) => m.ReplaceDialog));
const RmaDialog = dynamic(() => import('./warranty-dialogs').then((m) => m.RmaDialog));

type Open =
  | {
      kind: 'identify' | 'reject' | 'settle' | 'replace' | 'rma';
      returnFocusTo: ReturnFocusTo;
    }
  | undefined;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/**
 * A warranty claim's sheet (docs/03-roadmap-appendix/phase3.md §7.5): the customer, the failed
 * serial and its warranty, the five steps and where the claim stands, the next step for whoever
 * may take it, and, for a holder of `finance.cost.read` only, the replacement's cost and the
 * supplier's credit.
 */
export function WarrantyClaimScreen({
  claim,
  company,
  serials,
  costs,
  hubs = [],
  vendors = [],
  can,
}: {
  claim: WarrantyClaimDto;
  company: string;
  /** The customer's delivered serials, while the failed one is still to identify. */
  serials: readonly ClaimSerialDto[] | undefined;
  /** Only for a holder of `finance.cost.read`. */
  costs: WarrantyClaimCostsDto | undefined;
  /** The hubs and their bins, for a step that moves stock. */
  hubs?: readonly HubDto[];
  /** The active vendors, for the supplier return. */
  vendors?: readonly VendorListRowDto[];
  can: { write: boolean; rma: boolean; settle: boolean };
}) {
  const t = useTranslations('warranty');
  const stateText = useClaimStateText();
  const serialState = useSerialStateText();
  const router = useRouter();
  const [open, setOpen] = useState<Open>();
  const identifyButton = useRef<HTMLButtonElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const settleButton = useRef<HTMLButtonElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const rmaButton = useRef<HTMLButtonElement>(null);

  function saved() {
    setOpen(undefined);
    router.refresh();
  }

  const serialLine = (s: WarrantyClaimDto['serial']) =>
    s === null ? (
      t('notIdentified')
    ) : (
      <span className="flex flex-col">
        <Link href={serialHref(claim.entityId, s.id)} className="text-accent-text hover:underline">
          {s.serialNo}
        </Link>
        <span className="text-text-muted text-sm">
          {serialState(s.state)}
          {' · '}
          {s.warrantyUntil === null
            ? t('noWarrantyDate')
            : t('warrantyUntil', { date: formatDate(s.warrantyUntil) })}
        </span>
      </span>
    );

  const actions = (
    <>
      <Button asChild variant="secondary">
        <Link href={warrantyListHref(claim.entityId)}>{t('back')}</Link>
      </Button>
      {can.write && claim.state === 'raised' ? (
        <Button
          ref={identifyButton}
          onClick={() => {
            setOpen({ kind: 'identify', returnFocusTo: () => [identifyButton.current] });
          }}
        >
          {t('identify')}
        </Button>
      ) : null}
      {can.write && claim.state === 'serial_identified' ? (
        <Button
          ref={replaceButton}
          onClick={() => {
            setOpen({ kind: 'replace', returnFocusTo: () => [replaceButton.current] });
          }}
        >
          {t('replace')}
        </Button>
      ) : null}
      {can.rma && claim.state === 'replacement_issued' ? (
        <Button
          ref={rmaButton}
          onClick={() => {
            setOpen({ kind: 'rma', returnFocusTo: () => [rmaButton.current] });
          }}
        >
          {t('rma')}
        </Button>
      ) : null}
      {can.write && (claim.state === 'raised' || claim.state === 'serial_identified') ? (
        <Button
          ref={rejectButton}
          variant="secondary"
          onClick={() => {
            setOpen({ kind: 'reject', returnFocusTo: () => [rejectButton.current] });
          }}
        >
          {t('reject')}
        </Button>
      ) : null}
      {can.settle && claim.state === 'rma_raised' ? (
        <Button
          ref={settleButton}
          onClick={() => {
            setOpen({ kind: 'settle', returnFocusTo: () => [settleButton.current] });
          }}
        >
          {t('settle')}
        </Button>
      ) : null}
    </>
  );

  return (
    <Page
      width="detail"
      title={t('sheetTitle', { claim: claim.claimNo })}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={CLAIM_STATE_TONE[claim.state]}>{stateText(claim.state)}</StatusBadge>
          <span>{t('raisedOn', { date: formatDate(claim.createdAt), company })}</span>
        </span>
      }
      actions={actions}
    >
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact label={t('fields.customer')}>
          {claim.account.name === null ? (
            t('customerHidden')
          ) : (
            <Link
              href={customerHref(claim.account.id, claim.entityId)}
              className="text-accent-text hover:underline"
            >
              {claim.account.name}
            </Link>
          )}
        </Fact>
        <Fact label={t('fields.site')}>
          {claim.site === null ? t('noSite') : (claim.site.village ?? t('siteWithoutVillage'))}
        </Fact>
        <Fact label={t('fields.product')}>
          {claim.item === null ? t('notIdentified') : `${claim.item.name} (${claim.item.sku})`}
        </Fact>
        <Fact label={t('fields.serial')}>{serialLine(claim.serial)}</Fact>
        <Fact label={t('fields.fault')}>{claim.reportedFault}</Fact>
        {claim.replacementSerial === null ? null : (
          <Fact label={t('fields.replacement')}>{serialLine(claim.replacementSerial)}</Fact>
        )}
        {claim.vendor === null ? null : (
          <Fact label={t('fields.supplier')}>
            {claim.supplierRmaRef === null
              ? claim.vendor.name
              : t('supplierRef', { vendor: claim.vendor.name, ref: claim.supplierRmaRef })}
          </Fact>
        )}
        {claim.settlement === null ? null : (
          <Fact label={t('fields.settlement')}>{t(`settlements.${claim.settlement}`)}</Fact>
        )}
        {claim.rejectedReason === null ? null : (
          <Fact label={t('fields.rejectedReason')}>{claim.rejectedReason}</Fact>
        )}
      </dl>
      <section className="flex flex-col gap-2" aria-labelledby="claim-steps">
        <h2 id="claim-steps" className="text-lg font-semibold">
          {t('steps.title')}
        </h2>
        <ol className="flex list-decimal flex-col gap-1 ps-6">
          {claimSteps(claim.state).map(({ step, status }) => (
            <li
              key={step}
              aria-current={status === 'current' ? 'step' : undefined}
              className={status === 'next' ? 'text-text-muted' : undefined}
            >
              <span>{t(`steps.${step}`)}</span>
              {status === 'next' ? null : (
                <span className="text-text-muted ms-2 text-sm">{t(`stepStatus.${status}`)}</span>
              )}
            </li>
          ))}
        </ol>
      </section>
      {costs === undefined ? null : (
        <section className="flex flex-col gap-2" aria-labelledby="claim-costs">
          <h2 id="claim-costs" className="text-lg font-semibold">
            {t('costs.title')}
          </h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label={t('costs.replacement')}>
              {costs.replacementCost === null
                ? t('costs.none')
                : formatRupees(costs.replacementCost)}
            </Fact>
            <Fact label={t('costs.credit')}>
              {costs.supplierCreditAmount === null
                ? t('costs.none')
                : formatRupees(costs.supplierCreditAmount)}
            </Fact>
          </dl>
        </section>
      )}
      {open?.kind === 'identify' ? (
        <IdentifyDialog
          entityId={claim.entityId}
          claimId={claim.id}
          serials={serials ?? []}
          returnFocusTo={open.returnFocusTo}
          onClose={() => {
            setOpen(undefined);
          }}
          onSaved={saved}
        />
      ) : null}
      {open?.kind === 'reject' ? (
        <RejectDialog
          entityId={claim.entityId}
          claimId={claim.id}
          returnFocusTo={open.returnFocusTo}
          onClose={() => {
            setOpen(undefined);
          }}
          onSaved={saved}
        />
      ) : null}
      {open?.kind === 'replace' ? (
        <ReplaceDialog
          entityId={claim.entityId}
          claimId={claim.id}
          product={claim.item === null ? '' : claim.item.name}
          hubs={hubs}
          returnFocusTo={open.returnFocusTo}
          onClose={() => {
            setOpen(undefined);
          }}
          onSaved={saved}
        />
      ) : null}
      {open?.kind === 'rma' ? (
        <RmaDialog
          entityId={claim.entityId}
          claimId={claim.id}
          vendors={vendors}
          hubs={hubs}
          faultyBack={claim.serial?.state === 'faulty'}
          returnFocusTo={open.returnFocusTo}
          onClose={() => {
            setOpen(undefined);
          }}
          onSaved={saved}
        />
      ) : null}
      {open?.kind === 'settle' ? (
        <SettleDialog
          entityId={claim.entityId}
          claimId={claim.id}
          returnFocusTo={open.returnFocusTo}
          onClose={() => {
            setOpen(undefined);
          }}
          onSaved={saved}
        />
      ) : null}
    </Page>
  );
}
