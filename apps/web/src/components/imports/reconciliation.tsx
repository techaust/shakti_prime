'use client';

import type { ImportReconciliationDto } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import {
  reconciliationCsv,
  reconciliationLines,
  type ReconciliationLine,
} from '../../screens/import-reconciliation';
import { formatCount } from '../../screens/format';

/**
 * What became of every row of the file (IMP-01, IMP-02): the counts that add up to the rows in
 * the file, and why rows were not added, with the same figures as a CSV file to keep with the
 * cutover's count check.
 */
export function ReconciliationPanel({
  reconciliation,
  fileName,
}: {
  reconciliation: ImportReconciliationDto;
  fileName: string;
}) {
  const t = useTranslations('imports.reconcile');
  const lineLabel = useCallback((key: ReconciliationLine | 'rowsIn') => t(`lines.${key}`), [t]);
  const download = useCallback(() => {
    const csv = reconciliationCsv(reconciliation, {
      heading: { line: t('csvLine'), rows: t('csvRows') },
      line: lineLabel,
      reason: (reason) => t(`reasons.${reason}`),
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = t('csvFileName', { file: fileName.replace(/\.[^.]+$/, '') });
    link.click();
    URL.revokeObjectURL(url);
  }, [fileName, lineLabel, reconciliation, t]);

  const lines = reconciliationLines(reconciliation);
  return (
    <section
      className="border-border bg-surface flex flex-col gap-4 rounded-lg border p-4 sm:p-6"
      aria-labelledby="import-reconcile-title"
    >
      <div className="flex flex-col gap-1">
        <h2 id="import-reconcile-title" className="text-h2">
          {t('title')}
        </h2>
        <p className="text-text-muted">{t('intro')}</p>
      </div>
      <table className="w-full max-w-xl text-sm">
        <caption className="sr-only">{t('title')}</caption>
        <thead>
          <tr className="border-border border-b">
            <th scope="col" className="py-2 pr-4 text-left font-medium">
              {t('csvLine')}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {t('csvRows')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-border border-b last:border-b-0">
              <th
                scope="row"
                className={
                  line.key === 'rowsIn'
                    ? 'py-2 pr-4 text-left font-medium'
                    : 'py-2 pr-4 text-left font-normal'
                }
              >
                {lineLabel(line.key)}
              </th>
              <td className="py-2 text-right tabular-nums">{formatCount(line.rows)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {reconciliation.refusedByReason.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-h3">{t('reasonsTitle')}</h3>
          <table className="w-full max-w-xl text-sm">
            <caption className="sr-only">{t('reasonsTitle')}</caption>
            <tbody>
              {reconciliation.refusedByReason.map((x) => (
                <tr key={x.reason} className="border-border border-b last:border-b-0">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    {t(`reasons.${x.reason}`)}
                  </th>
                  <td className="py-2 text-right tabular-nums">{formatCount(x.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={download}>
          {t('downloadCsv')}
        </Button>
      </div>
    </section>
  );
}
