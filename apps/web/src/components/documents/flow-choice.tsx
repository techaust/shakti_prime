'use client';

import type { DocumentFlow } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { DOCUMENT_FLOWS } from '../../screens/document-values';

/**
 * The choice of project flow whose requirements a documents screen shows (the Documents section
 * and Settings › Document requirements), one pressed button per flow, as the price master's
 * sections are chosen.
 */
export function FlowChoice({
  flow,
  onFlow,
  label,
  showLabel = false,
}: {
  flow: DocumentFlow;
  onFlow: (flow: DocumentFlow) => void;
  /** Names the group for a screen reader, and on screen too with `showLabel`. */
  label: string;
  showLabel?: boolean;
}) {
  const t = useTranslations('documents');
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {showLabel ? (
        <span aria-hidden="true" className="text-text-muted text-sm">
          {label}
        </span>
      ) : null}
      {DOCUMENT_FLOWS.map((f) => (
        <Button
          key={f}
          size="sm"
          variant={f === flow ? 'primary' : 'secondary'}
          aria-pressed={f === flow}
          onClick={() => {
            onFlow(f);
          }}
        >
          {t(`flow.${f}`)}
        </Button>
      ))}
    </div>
  );
}
