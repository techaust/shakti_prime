import { cn } from '@shakti/ui';
import Link from 'next/link';

/**
 * Procurement's pages as tabs: plain links, so neither page loads the other's data. The
 * comparison's tab is shown only to a holder of `procurement.rate.read`.
 */
export function ProcurementTabs({
  current,
  label,
  vendors,
  compare,
  orders,
  receipts,
}: {
  current: 'vendors' | 'compare' | 'orders' | 'receipts';
  label: string;
  vendors: string;
  /** The comparison tab's words; left out for a person who reads no rates. */
  compare?: string | undefined;
  /** U2: purchase orders and goods receipts, for whoever reads a company's orders. */
  orders?: string | undefined;
  receipts?: string | undefined;
}) {
  const tabs = [
    ...(orders === undefined
      ? []
      : [{ key: 'orders', href: '/procurement/orders', text: orders }]),
    ...(receipts === undefined
      ? []
      : [{ key: 'receipts', href: '/procurement/receipts', text: receipts }]),
    { key: 'vendors', href: '/procurement/vendors', text: vendors },
    ...(compare === undefined
      ? []
      : [{ key: 'compare', href: '/procurement/compare', text: compare }]),
  ] as const;
  return (
    <nav aria-label={label} className="border-border flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? 'page' : undefined}
          className={cn(
            'text-text-muted hover:text-text -mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 font-medium',
            current === tab.key && 'border-accent text-text',
          )}
        >
          {tab.text}
        </Link>
      ))}
    </nav>
  );
}
