'use client';

import type { TallyConnectorDto } from '@shakti/contracts';
import { Button, EmptyState, Field, Input, Select, Skeleton, StatusBadge, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type SyntheticEvent } from 'react';
import {
  listTallyConnectors,
  mapTallyCompany,
  registerTallyConnector,
  retireTallyConnectorKey,
  revokeTallyConnector,
  rotateTallyConnectorKey,
  unmapTallyCompany,
} from '../../actions/tally';
import { momentValues } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

type Company = { id: number; name: string };

/** A key made just now, shown once: whose it is and the key itself. */
interface ShownKey {
  connectorId: string;
  name: string;
  key: string;
  rotated: boolean;
}

/**
 * Admin › Integrations › Tally (TC2, docs/03-roadmap-appendix/phase5.md §6.3): set up the connector
 * that runs on the office computer beside Tally (its key shown once), link each Tally company to
 * one of the group's companies, make a new key and turn the old one off, and turn a connector off.
 * An Executive's screen (`admin.integrations.write`).
 */
export function TallyConnectorsScreen({ companies }: { companies: readonly Company[] }) {
  const t = useTranslations('tallyConnectors');
  const id = useId();
  const { load, failure } = useQuery<TallyConnectorDto[]>();
  const [connectors, setConnectors] = useState<TallyConnectorDto[] | undefined>();
  const [shown, setShown] = useState<ShownKey | undefined>();
  const register = useCommand(registerTallyConnector, 'tally:register');

  const reload = useCallback(() => {
    load(() => listTallyConnectors(), setConnectors);
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (register.pending) return;
    const form = e.currentTarget;
    const name = formText(new FormData(form), 'name');
    register.run({ name }, (made) => {
      setShown({
        connectorId: made.connector.id,
        name: made.connector.name,
        key: made.key,
        rotated: false,
      });
      form.reset();
      reload();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {shown === undefined ? null : (
        <KeyShownOnce
          shown={shown}
          onDone={() => {
            setShown(undefined);
          }}
        />
      )}
      <section aria-labelledby={`${id}-new`} className="flex flex-col gap-3">
        <h2 id={`${id}-new`} className="text-h2">
          {t('newHeading')}
        </h2>
        <p className="text-text-muted text-sm">{t('newIntro')}</p>
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <Field
            id={`${id}-name`}
            label={t('name')}
            helper={t('nameHelper')}
            actions={
              <Button type="submit" pending={register.pending}>
                {t('register')}
              </Button>
            }
          >
            <Input name="name" required maxLength={80} autoComplete="off" />
          </Field>
          <FailureMessage failure={register.failure} />
        </form>
      </section>
      <section aria-labelledby={`${id}-list`} className="flex flex-col gap-3">
        <h2 id={`${id}-list`} className="text-h2">
          {t('listHeading')}
        </h2>
        {connectors === undefined ? (
          failure === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <FailureMessage failure={failure} />
          )
        ) : connectors.length === 0 ? (
          <EmptyState message={t('none')} />
        ) : (
          <ul className="flex flex-col gap-6" aria-label={t('listHeading')}>
            {connectors.map((c) => (
              <ConnectorCard
                key={c.id}
                connector={c}
                companies={companies}
                onKey={setShown}
                onChanged={reload}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The key just made, with what the office computer's setup asks for, shown this once. */
function KeyShownOnce({ shown, onDone }: { shown: ShownKey; onDone: () => void }) {
  const t = useTranslations('tallyConnectors');
  return (
    <div role="status" className="border-border bg-card flex flex-col gap-2 rounded-md border p-4">
      <p className="font-semibold">
        {shown.rotated ? t('keyRotated', { name: shown.name }) : t('keyMade', { name: shown.name })}
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-text-muted">{t('connectorNumber')}</dt>
        <dd>
          <code data-dynamic className="font-mono break-all">
            {shown.connectorId}
          </code>
        </dd>
        <dt className="text-text-muted">{t('key')}</dt>
        <dd>
          <code data-dynamic className="bg-muted rounded-sm px-2 py-1 font-mono break-all">
            {shown.key}
          </code>
        </dd>
      </dl>
      <p className="text-text-muted text-sm">{t('keyOnce')}</p>
      <div>
        <Button variant="secondary" size="sm" onClick={onDone}>
          {t('keyCopied')}
        </Button>
      </div>
    </div>
  );
}

function ConnectorCard({
  connector,
  companies,
  onKey,
  onChanged,
}: {
  connector: TallyConnectorDto;
  companies: readonly Company[];
  onKey: (shown: ShownKey) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('tallyConnectors');
  const id = useId();
  const rotate = useCommand(rotateTallyConnectorKey, `tally:rotate:${connector.id}`);
  const retire = useCommand(retireTallyConnectorKey);
  const revoke = useCommand(revokeTallyConnector);
  const map = useCommand(mapTallyCompany, `tally:map:${connector.id}`);
  const unmap = useCommand(unmapTallyCompany);
  const live = connector.revokedAt === null;
  const companyName = (entityId: number) =>
    companies.find((c) => c.id === entityId)?.name ?? t('otherCompany');

  function link(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (map.pending) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    map.run(
      {
        connectorId: connector.id,
        tallyCompany: formText(data, 'tallyCompany'),
        entityId: Number(formText(data, 'entityId')),
      },
      () => {
        toast.success(t('linked'));
        form.reset();
        onChanged();
      },
    );
  }

  return (
    <li className="border-border flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-h3">{connector.name}</h3>
          <span className="text-text-muted text-sm">
            {t('endsWith', { hint: connector.keyHint })}
          </span>
          {connector.nextKeyHint === null ? null : (
            <span className="text-text-muted text-sm">
              {t('newEndsWith', { hint: connector.nextKeyHint })}
            </span>
          )}
          <span className="text-text-muted text-sm">
            {connector.lastHeartbeatAt === null
              ? t('neverCheckedIn')
              : t.rich('lastCheckIn', momentValues(connector.lastHeartbeatAt))}
          </span>
          {connector.connectorVersion === null ? null : (
            <span className="text-text-muted text-sm">
              {t('version', { version: connector.connectorVersion })}
            </span>
          )}
        </div>
        {live ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              pending={rotate.pending}
              onClick={() => {
                rotate.run({ connectorId: connector.id }, (made) => {
                  onKey({
                    connectorId: made.connector.id,
                    name: made.connector.name,
                    key: made.key,
                    rotated: true,
                  });
                  onChanged();
                });
              }}
            >
              {t('rotate')}
            </Button>
            {connector.nextKeyHint === null ? null : (
              <Button
                variant="secondary"
                size="sm"
                pending={retire.pending}
                onClick={() => {
                  retire.run({ connectorId: connector.id }, () => {
                    toast.success(t('oldKeyOff'));
                    onChanged();
                  });
                }}
              >
                {t('retire')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              pending={revoke.pending}
              aria-label={t('revokeLabel', { name: connector.name })}
              onClick={() => {
                revoke.run({ connectorId: connector.id }, () => {
                  toast.success(t('revoked', { name: connector.name }));
                  onChanged();
                });
              }}
            >
              {t('revoke')}
            </Button>
          </div>
        ) : (
          <StatusBadge tone="neutral">{t('off')}</StatusBadge>
        )}
      </div>
      <FailureMessage failure={rotate.failure ?? retire.failure ?? revoke.failure} />
      <div className="flex flex-col gap-2">
        <h4 className="font-semibold">{t('companiesHeading')}</h4>
        {connector.companies.length === 0 ? (
          <p className="text-text-muted text-sm">{t('noCompanies')}</p>
        ) : (
          <ul className="divide-border flex flex-col divide-y" aria-label={t('companiesHeading')}>
            {connector.companies.map((m) => (
              <li
                key={`${String(m.entityId)}-${m.tallyCompany}`}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <span>
                  {t('linkedTo', { tally: m.tallyCompany, company: companyName(m.entityId) })}
                </span>
                {live ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    pending={unmap.pending}
                    aria-label={t('unlinkLabel', { company: companyName(m.entityId) })}
                    onClick={() => {
                      unmap.run({ connectorId: connector.id, entityId: m.entityId }, () => {
                        toast.success(t('unlinked'));
                        onChanged();
                      });
                    }}
                  >
                    {t('unlink')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <FailureMessage failure={unmap.failure} />
        {live ? (
          <form onSubmit={link} noValidate className="flex flex-col gap-2">
            <Field id={`${id}-company`} label={t('company')}>
              <Select name="entityId" defaultValue={String(companies[0]?.id ?? '')}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id={`${id}-tally`}
              label={t('tallyCompany')}
              helper={t('tallyCompanyHelper')}
              actions={
                <Button type="submit" pending={map.pending}>
                  {t('link')}
                </Button>
              }
            >
              <Input name="tallyCompany" required maxLength={120} autoComplete="off" />
            </Field>
            <FailureMessage failure={map.failure} />
          </form>
        ) : null}
      </div>
    </li>
  );
}
