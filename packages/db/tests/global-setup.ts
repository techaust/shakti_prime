// Migrate and seed once before the security suite (docs/SECURITY.md §11).
import { prepareDatabase } from '../src/testing/index';

export default async function setup(): Promise<void> {
  await prepareDatabase();
}
