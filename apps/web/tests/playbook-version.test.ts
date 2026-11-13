import { newId, SYSTEM_MATRIX, SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import { memoryKeyValue, PLAYBOOK_VERSION_KEY } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { workerFor } from './registry';

// A Playbook change bumps the version the agents and Ask compare before reusing the approved
// directives (docs/03-roadmap-appendix/phase2.md §5.4).
describe('knowledge.playbook.changed', () => {
  it('writes a new Playbook version on every delivery', async () => {
    const worker = workerFor('knowledge.playbook.changed');
    expect(worker).toBeDefined();
    const keyValue = memoryKeyValue();
    const deliver = () =>
      worker?.handle(
        {
          id: newId(),
          sequence: '1',
          type: 'knowledge.playbook.changed',
          entityId: 1,
          aggregateType: 'playbook_directive',
          aggregateId: newId(),
          payload: {
            v: 1,
            directiveEntityId: 1,
            change: 'approved',
            state: 'approved',
            recheck: false,
          },
        },
        {
          principal: {
            id: SYSTEM_WORKERS_PRINCIPAL_ID,
            kind: 'system',
            roleKey: 'system:workers',
            entityIds: [1],
            permissions: [...SYSTEM_MATRIX['system:workers']],
          },
          keyValue,
          requestId: newId(),
          now: new Date(),
          startedAt: 0,
        },
      );
    await deliver();
    const first = await keyValue.get(PLAYBOOK_VERSION_KEY);
    expect(first).not.toBeNull();
    await deliver();
    expect(await keyValue.get(PLAYBOOK_VERSION_KEY)).not.toBe(first);
  });
});
