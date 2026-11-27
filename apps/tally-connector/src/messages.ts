import type { ConfigProblem } from './config';

/**
 * Every sentence the connector shows a person: the setup's questions and answers, and the reason
 * the service will not start. The connector is a separate program and cannot read the web's message
 * catalogue, so its few sentences live here, in the same plain English (docs/08-design-system.md §11).
 */
export const MESSAGES = {
  setupIntro:
    'This sets up the Tally connector on this computer. Have the connector id and key from Admin, Integrations, Tally in the BOS ready, and the exact name of each Tally company.',
  askBosUrl: 'BOS address (for example https://shaktiprime.com): ',
  askConnectorId: 'Connector id: ',
  askKey: 'Connector key (nothing shows as you type): ',
  askCompany: 'Tally company name, exactly as Tally shows it (press Enter on an empty line when done): ',
  askEntityCode: 'Which BOS company is it (SS, SMP, ASH or RCREF): ',
  saved: 'Settings saved. They can be opened only by this Windows account on this computer.',
  testing: 'Checking that the BOS answers...',
  testOk: 'The BOS answered. The connector is ready to start as a service.',
  testRefused:
    'The BOS refused the connector. Check the connector id and key in Admin, Integrations, Tally, then run the setup again.',
  testUnavailable:
    'The BOS did not answer. The settings are saved; the service will keep trying once it starts. Check the internet connection.',
  tallyNotOpen: (count: number) =>
    `Tally did not answer for ${String(count)} of the companies. Open them in Tally with its XML server on, and the connector will read them.`,
  usage: 'Use one of: setup, run, version.',
  problems: {
    bos_url: 'The BOS address must start with https:// and name the BOS, for example https://shaktiprime.com.',
    connector_id: 'The connector id is the long code shown in Admin, Integrations, Tally. Copy it again.',
    key: 'The connector key is too short or has spaces around it. Copy it again from the BOS.',
    companies:
      'Give at least one Tally company, each name once, each with a BOS company code of capital letters.',
    missing: 'The connector is not set up yet. Run it with "setup" first.',
    unreadable:
      'The settings could not be opened. Run the setup again under the account the service runs as.',
    plain_refused:
      'The settings file is not sealed for this computer. Run the setup again under the account the service runs as.',
    sealed_elsewhere: 'The settings were sealed on Windows and open only there.',
  } satisfies Record<ConfigProblem, string>,
} as const;
