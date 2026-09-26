import { prepareDatabase } from '@shakti/db/testing';

export default async function setup(): Promise<void> {
  await prepareDatabase();
}
