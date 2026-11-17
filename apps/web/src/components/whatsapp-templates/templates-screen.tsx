'use client';

import {
  WHATSAPP_LIVE_MILESTONES,
  WHATSAPP_MILESTONE_VALUES,
  type WhatsAppMilestoneDto,
  type WhatsAppTemplateDto,
  type WhatsAppTemplateSettingsDto,
} from '@shakti/contracts';
import { Button, EmptyState, Field, Select, StatusBadge, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { setWhatsAppMilestone } from '../../actions/whatsapp-templates';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

type LiveMilestone = (typeof WHATSAPP_LIVE_MILESTONES)[number];

const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paused: 'warning',
  disabled: 'neutral',
} as const;

/** The templates a milestone may send: the company's own, for people, with its values' count. */
function fitFor(milestone: LiveMilestone, templates: readonly WhatsAppTemplateDto[]) {
  return templates.filter(
    (t) =>
      t.purpose === null &&
      t.category !== 'authentication' &&
      t.params.length === WHATSAPP_MILESTONE_VALUES[milestone].length,
  );
}

/**
 * Settings › WhatsApp templates (docs/03-roadmap-appendix/phase2.md §7.1): each company's
 * registered templates with their review state and use, and the customer updates its number sends,
 * each mapped to one of its templates. An update whose template is not approved is held, not
 * sent (WA-01). Only those who may change templates get the form; others read the map.
 */
export function TemplatesScreen({
  companies,
  initial,
  canChange,
}: {
  companies: readonly { id: number; name: string }[];
  initial: WhatsAppTemplateSettingsDto;
  canChange: boolean;
}) {
  const t = useTranslations('whatsappTemplates');
  const values = useTranslations('activity.values');
  const [milestones, setMilestones] = useState(initial.milestones);
  return (
    <div className="flex flex-col gap-8">
      {companies.map((company) => {
        const templates = initial.templates.filter((tpl) => tpl.entityId === company.id);
        return (
          <section
            key={company.id}
            aria-labelledby={`company-${String(company.id)}`}
            className="flex flex-col gap-4"
          >
            <h2 id={`company-${String(company.id)}`} className="text-h3">
              {company.name}
            </h2>
            <h3 className="font-medium">{t('updatesHeading')}</h3>
            <p className="text-text-muted text-sm">{t('updatesIntro')}</p>
            <div className="flex flex-col gap-4">
              {WHATSAPP_LIVE_MILESTONES.map((milestone) => (
                <MilestoneRow
                  key={milestone}
                  entityId={company.id}
                  milestone={milestone}
                  templates={fitFor(milestone, templates)}
                  current={milestones.find(
                    (m) => m.entityId === company.id && m.milestone === milestone,
                  )}
                  canChange={canChange}
                  onSaved={(saved) => {
                    setMilestones((all) => [
                      ...all.filter((m) => m.id !== saved.id),
                      saved,
                    ]);
                  }}
                />
              ))}
            </div>
            <h3 className="font-medium">{t('templatesHeading')}</h3>
            {templates.length === 0 ? (
              <EmptyState message={t('noTemplates')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    {t('templatesCaption', { company: company.name })}
                  </caption>
                  <thead>
                    <tr className="text-text-muted text-left">
                      <th scope="col" className="py-2 pe-4 font-medium">
                        {t('columns.label')}
                      </th>
                      <th scope="col" className="py-2 pe-4 font-medium">
                        {t('columns.kind')}
                      </th>
                      <th scope="col" className="py-2 pe-4 font-medium">
                        {t('columns.use')}
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        {t('columns.status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((tpl) => (
                      <tr key={tpl.id} className="border-border border-t">
                        <td className="py-2 pe-4">
                          <span className="block">{tpl.label}</span>
                          <span className="text-text-muted block break-all">{tpl.name}</span>
                        </td>
                        <td className="py-2 pe-4">
                          {values(`whatsappTemplateCategory.${tpl.category}`)}
                        </td>
                        <td className="py-2 pe-4">
                          {tpl.purpose === null
                            ? t('sentByPeople')
                            : values(`whatsappTemplatePurpose.${tpl.purpose}`)}
                        </td>
                        <td className="py-2">
                          <StatusBadge tone={STATUS_TONE[tpl.status]}>
                            {values(`whatsappTemplateStatus.${tpl.status}`)}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MilestoneRow({
  entityId,
  milestone,
  templates,
  current,
  canChange,
  onSaved,
}: {
  entityId: number;
  milestone: LiveMilestone;
  templates: readonly WhatsAppTemplateDto[];
  current: WhatsAppMilestoneDto | undefined;
  canChange: boolean;
  onSaved: (saved: WhatsAppMilestoneDto) => void;
}) {
  const t = useTranslations('whatsappTemplates');
  const values = useTranslations('activity.values');
  const { run, pending, failure } = useCommand(setWhatsAppMilestone);
  const id = `milestone-${String(entityId)}-${milestone}`;
  const label = values(`whatsappMilestone.${milestone}`);
  const chosen = templates.find((tpl) => tpl.id === current?.templateId);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    const templateId = formText(form, 'templateId');
    if (templateId === '') return;
    run(
      { entityId, milestone, templateId, isActive: form.get('isActive') === 'on' },
      (saved) => {
        onSaved(saved);
        toast.success(t('saved', { update: label }));
      },
    );
  }

  if (!canChange) {
    return (
      <p>
        <span className="font-medium">{label}: </span>
        {chosen === undefined
          ? t('notSet')
          : current?.isActive === false
            ? t('offWith', { template: chosen.label })
            : chosen.label}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <Field
        id={id}
        label={label}
        helper={templates.length === 0 ? t('noFit') : t(`helper.${milestone}`)}
        actions={
          <Button type="submit" variant="secondary" pending={pending} disabled={templates.length === 0}>
            {t('save')}
          </Button>
        }
      >
        <Select name="templateId" defaultValue={current?.templateId ?? ''} required>
          <option value="" disabled>
            {t('choose')}
          </option>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.status === 'approved'
                ? tpl.label
                : t('notApprovedOption', {
                    template: tpl.label,
                    status: values(`whatsappTemplateStatus.${tpl.status}`),
                  })}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          className="accent-accent size-4"
          defaultChecked={current?.isActive ?? true}
        />
        {t('active')}
      </label>
      <FailureMessage failure={failure} />
    </form>
  );
}
