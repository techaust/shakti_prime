import { redirect } from 'next/navigation';
import { navRequires } from '../../../nav';
import { screenAccess } from '../../../screens/access';

/** Procurement opens on its vendor list. */
export default async function ProcurementPage() {
  await screenAccess(navRequires('procurement'));
  redirect('/procurement/vendors');
}
