'use client';

import type { CallerPresence } from '@shakti/contracts';
import { toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { savePresence } from '../../actions/handover';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

export interface PresenceRow {
  entityId: number;
  company: string;
  presence: CallerPresence;
}

/**
 * Profile › Taking new leads (docs/03-roadmap-appendix/phase1.md §8.2): the person's own presence in each
 * company they work in, which the handover reads. A switch saves at once
 * (`crm.caller_profile.set_presence`); only the person's own presence is ever changed here.
 */
export function PresenceForm({ rows }: { rows: PresenceRow[] }) {
  const t = useTranslations('profile.presence');
  const [state, setState] = useState(rows);
  const { run, pending, failure } = useCommand(savePresence);

  function change(row: PresenceRow, present: boolean) {
    const presence: CallerPresence = present ? 'present' : 'away';
    run({ entityId: row.entityId, presence }, (saved) => {
      setState((all) =>
        all.map((r) => (r.entityId === row.entityId ? { ...r, presence: saved.presence } : r)),
      );
      toast.success(t(saved.presence, { company: row.company }));
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-h3">{t('heading')}</h2>
      <p className="text-text-muted text-sm">{t('intro')}</p>
      {state.map((row) => (
        <label key={row.entityId} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-accent size-4"
            checked={row.presence === 'present'}
            disabled={pending}
            onChange={(e) => {
              change(row, e.currentTarget.checked);
            }}
          />
          {t('label', { company: row.company })}
        </label>
      ))}
      <FailureMessage failure={failure} />
    </div>
  );
}
