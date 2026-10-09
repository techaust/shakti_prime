// Puts the pipelines the journeys edit back as the seed leaves them, through the app's own commands
// (`crm.stage.archive`, `crm.stage.update`), so a run on a database an earlier run used, or one
// that stopped half way, starts from the same stages (pipelines.spec.ts).
import { asMigrator, principalFor } from '@shakti/db/testing';
import { archiveStage, executeCommand, updateStage } from '@shakti/domain';

/** The stage the "adds a stage" journey makes in Commercial EPC; it is named with a number. */
const JOURNEY_STAGE = 'Site survey %';
/** The stage the "a changed stage name" journey renames and names back. */
const RENAMED_STAGE = { pipeline: 'Dealer and Wholesale', key: 'contacted', name: 'Contacted' };

export async function resetPipelineStages(executiveId: string): Promise<void> {
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  const leftovers = await asMigrator(
    (m) => m<{ id: string }[]>`
      select s.id
        from pipeline_stages s join pipelines p on p.id = s.pipeline_id
       where p.name = 'Commercial EPC' and s.name like ${JOURNEY_STAGE} and s.archived_at is null`,
  );
  for (const stage of leftovers)
    await executeCommand(executive, {}, archiveStage, { stageId: stage.id });

  const renamed = await asMigrator(
    (m) => m<{ id: string; name: string }[]>`
      select s.id, s.name
        from pipeline_stages s join pipelines p on p.id = s.pipeline_id
       where p.name = ${RENAMED_STAGE.pipeline} and s.key = ${RENAMED_STAGE.key}`,
  );
  for (const stage of renamed) {
    if (stage.name !== RENAMED_STAGE.name) {
      await executeCommand(executive, {}, updateStage, {
        stageId: stage.id,
        name: RENAMED_STAGE.name,
      });
    }
  }
}
