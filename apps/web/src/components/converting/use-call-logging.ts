'use client';

import type { CallLeadDto, DispositionDto } from '@shakti/contracts';
import { toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { dialNumber, logCall } from '../../actions/calling';
import { outcomeNeeds, type OutcomeNeed } from '../../screens/calling';
import { savedMessage } from '../calling/calling-parts';
import type { OutcomeDetail } from '../calling/outcome-dialog';
import { useCommand, useQuery } from '../screens/use-command';

/**
 * Logging a call on the open lead, as the Cold Caller workspace does it (`calls.log`): the number
 * to dial, the outcome picked (with the detail it needs, asked for in a dialog) and the save.
 * `onSaved` runs once a call is saved, so the screen can read the lead and the board again.
 */
export function useCallLogging(lead: CallLeadDto | null, onSaved: () => void) {
  const t = useTranslations('calling');
  const [number, setNumber] = useState<{ opportunityId: string; e164: string }>();
  const [picked, setPicked] = useState<{ outcome: DispositionDto; need: OutcomeNeed }>();
  const dial = useQuery<{ e164: string }>();
  // One form per lead: another lead's call is sent under a key of its own.
  const save = useCommand(logCall, lead?.opportunityId);

  const showNumber = useCallback(() => {
    if (lead === null) return;
    dial.load(
      () => dialNumber({ entityId: lead.entityId, opportunityId: lead.opportunityId }),
      (n) => {
        setNumber({ opportunityId: lead.opportunityId, e164: n.e164 });
      },
    );
  }, [dial, lead]);

  const saveCall = useCallback(
    (outcome: DispositionDto, detail: OutcomeDetail | Record<string, never> = {}) => {
      if (lead === null) return;
      save.run(
        {
          entityId: lead.entityId,
          opportunityId: lead.opportunityId,
          dispositionId: outcome.id,
          ...detail,
        },
        (result) => {
          setPicked(undefined);
          toast.success(savedMessage(t, result));
          onSaved();
        },
      );
    },
    [lead, save, t, onSaved],
  );

  const pick = useCallback(
    (outcome: DispositionDto) => {
      if (lead === null || !lead.canLog || lead.consentWithdrawn || save.pending) return;
      const need = outcomeNeeds(outcome.nextAction, lead.state);
      if (need === undefined) saveCall(outcome);
      else setPicked({ outcome, need });
    },
    [lead, save, saveCall],
  );

  return {
    shown: number?.opportunityId === lead?.opportunityId ? number?.e164 : undefined,
    showNumber,
    dial,
    picked,
    setPicked,
    pick,
    saveCall,
    save,
  };
}
