'use client';

import { Field, Select } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { RoleNameKey } from '../../i18n/types';
import type { RoleChoices } from '../../screens/user-roles';

/**
 * A role per company for the invite and roles forms: one select per company being viewed, with
 * No access first. The choices are the fixed staff roles (docs/SECURITY.md §3.1).
 */
export function RolesField({
  idPrefix,
  companies,
  roleKeys,
  choices,
  onChange,
  error,
}: {
  idPrefix: string;
  companies: readonly { id: number; name: string }[];
  roleKeys: readonly string[];
  choices: RoleChoices;
  onChange: (next: RoleChoices) => void;
  error?: string | undefined;
}) {
  const t = useTranslations('users.rolesField');
  const roles = useTranslations('roles');
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-text-muted mb-1 text-sm font-medium">{t('legend')}</legend>
      <p className="text-text-subtle text-xs">{t('helper')}</p>
      {companies.map((c, index) => (
        <Field
          key={c.id}
          id={`${idPrefix}-${String(c.id)}`}
          label={c.name}
          // The one message about the whole set sits under the first company.
          error={index === 0 ? error : undefined}
        >
          <Select
            value={choices[c.id] ?? ''}
            onChange={(e) => {
              onChange({ ...choices, [c.id]: e.currentTarget.value });
            }}
          >
            <option value="">{t('none')}</option>
            {roleKeys.map((key) => (
              <option key={key} value={key}>
                {roles(key as RoleNameKey)}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </fieldset>
  );
}
