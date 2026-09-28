import {
  DomainError,
  ImportJobDto,
  MapImportJobInput,
  newId,
  type ImportMapping,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, ne } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertImportJobMove } from '../../imports/job-state';
import {
  assertEntityInScope,
  jobState,
  loadJob,
  parseStoredMapping,
  toImportJobDto,
  updateJob,
} from './shared';

/**
 * `imports.job.map` (IMP-01): matches the job's columns to lead fields, from a mapping given now
 * or a saved template of the same kind, and saves a new mapping as a template when asked. A job
 * may be mapped again until it commits; its rows then wait for a fresh preview.
 */
export const mapImportJob = defineCommand({
  name: 'imports.job.map',
  permission: 'imports.write',
  minScope: 'entity',
  input: MapImportJobInput,
  output: ImportJobDto,
  auditFields: ['state', 'kind', 'name', 'mapping'],
  constraintReasons: { import_mapping_templates_name_unique: 'import_template_name_taken' },
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const loaded = await loadJob(ctx.tx, input.entityId, input.jobId, true);
    const before = jobState(loaded.job);
    assertImportJobMove(before, 'mapped');

    let mapping: ImportMapping;
    let templateId: string | null = null;
    if (input.templateId !== undefined) {
      const t = schema.importMappingTemplates;
      const [template] = await ctx.tx
        .select({ id: t.id, mapping: t.mappingJson })
        .from(t)
        .where(
          and(
            eq(t.id, input.templateId),
            eq(t.entityId, input.entityId),
            eq(t.kind, loaded.job.kind),
          ),
        )
        .limit(1);
      if (!template) {
        throw new DomainError('not_found', 'import template is not available', {
          reason: 'import_template_missing',
        });
      }
      mapping = parseStoredMapping(template.mapping);
      templateId = template.id;
    } else if (input.mapping !== undefined) {
      mapping = input.mapping;
    } else {
      throw new DomainError('validation_failed', 'a mapping or a template is required');
    }

    const columns = new Set(loaded.job.columnsJson as string[]);
    const missing = Object.values(mapping.columns).filter((c) => !columns.has(c));
    if (missing.length > 0) {
      throw new DomainError('validation_failed', 'the mapping names a column the file lacks', {
        reason: 'import_mapping_column_missing',
      });
    }

    if (input.saveAsTemplate !== undefined) {
      templateId = newId();
      await ctx.tx.insert(schema.importMappingTemplates).values({
        id: templateId,
        entityId: input.entityId,
        kind: loaded.job.kind,
        name: input.saveAsTemplate.name,
        mappingJson: mapping,
        createdBy: ctx.principal.id,
      });
      ctx.audit({
        aggregateType: 'import_mapping_template',
        aggregateId: templateId,
        entityId: input.entityId,
        after: { kind: loaded.job.kind, name: input.saveAsTemplate.name, mapping },
      });
    }

    // Findings of an earlier preview no longer hold for a new mapping.
    const r = schema.importRows;
    await ctx.tx
      .update(r)
      .set({
        state: 'pending',
        normalisedJson: null,
        errorsJson: [],
        dedupeJson: null,
        updatedBy: ctx.principal.id,
      })
      .where(and(eq(r.jobId, loaded.job.id), ne(r.state, 'pending')));

    const mapped = await updateJob(ctx.tx, loaded, {
      templateId,
      mappingJson: mapping,
      state: 'mapped',
      validRows: 0,
      invalidRows: 0,
      skippedRows: 0,
      updatedBy: ctx.principal.id,
    });

    ctx.audit({
      aggregateType: 'import_job',
      aggregateId: loaded.job.id,
      entityId: input.entityId,
      before: { state: before, templateId: loaded.job.templateId, mapping: loaded.job.mappingJson },
      after: { state: 'mapped', templateId, mapping },
    });

    return toImportJobDto(mapped);
  },
});
