// Migrate and seed once before the security suite (docs/SECURITY.md §11).
import { catalogueFixture, identityFixture, prepareDatabase } from '../src/testing/index';

export default async function setup(): Promise<void> {
  await prepareDatabase();
  // Shared catalogue rows so the fail-closed loop can assert the tables are readable in context.
  await catalogueFixture();
  await identityFixture();
}
