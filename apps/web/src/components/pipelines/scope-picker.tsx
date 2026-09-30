'use client';

import { Field, Select } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { SEGMENTS } from '../../screens/contract-values';
import type { CompanyChoice } from './pipeline-settings-screen';

/** A scope as the two pickers hold it: `group` and `all` mean shared by every company or line. */
export interface ScopeValue {
  company: string;
  segment: string;
}

/** The company and business line a list of call outcomes or score rules belongs to. */
export function ScopePicker({
  idPrefix,
  companies,
  value,
  onChange,
}: {
  idPrefix: string;
  companies: CompanyChoice[];
  value: ScopeValue;
  onChange: (value: ScopeValue) => void;
}) {
  const t = useTranslations('pipelineSettings');
  const activity = useTranslations('activity');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${idPrefix}-company`} label={t('scopeCompany')}>
        <Select
          value={value.company}
          onChange={(e) => {
            onChange({ ...value, company: e.currentTarget.value });
          }}
        >
          <option value="group">{t('scopeGroup')}</option>
          {companies.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${idPrefix}-segment`} label={t('scopeSegment')}>
        <Select
          value={value.segment}
          onChange={(e) => {
            onChange({ ...value, segment: e.currentTarget.value });
          }}
        >
          <option value="all">{t('scopeAllSegments')}</option>
          {SEGMENTS.map((segment) => (
            <option key={segment} value={segment}>
              {activity(`values.segment.${segment}`)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
