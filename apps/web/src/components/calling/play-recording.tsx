'use client';

import type { RecordingAddressDto } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { playRecording } from '../../actions/dialling';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

/**
 * Play recording on a call's timeline row (docs/03-roadmap-appendix/phase2.md §6.3): shown only
 * where the reader may hear it (`app.playable_recordings()`), it asks for a 15-minute address
 * (`calls.recording.play`, each listen audited) and plays it here.
 */
export function PlayRecording({
  entityId,
  providerCallId,
}: {
  entityId: number;
  providerCallId: string;
}) {
  const t = useTranslations('customers.timeline');
  const { load, pending, failure } = useQuery<RecordingAddressDto>();
  const [address, setAddress] = useState<string>();
  if (address !== undefined) {
    return (
      <audio controls autoPlay src={address} aria-label={t('recordingLabel')} className="w-full max-w-sm" />
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        pending={pending}
        onClick={() => {
          load(
            () => playRecording({ entityId, providerCallId }),
            (dto) => {
              setAddress(dto.url);
            },
          );
        }}
      >
        {t('play')}
      </Button>
      <FailureMessage failure={failure} />
    </span>
  );
}
