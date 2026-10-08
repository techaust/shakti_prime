import {
  newId,
  type NoticePayload,
  type NoticeSubjectType,
  type NoticeType,
  type WrittenNoticeDto,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { choiceFor, pushPlan, type NoticeSettingRow } from '../../notifications/push-plan';

/** One notice to write: for whom, about what, and the reason that makes it one per person. */
export interface NoticeDraft {
  userId: string;
  type: NoticeType;
  subjectType: NoticeSubjectType;
  subjectId: string;
  payload: NoticePayload;
  dedupeKey: string;
}

interface SettingRow {
  user_id: string;
  type: string | null;
  in_app: boolean;
  push: boolean;
  quiet_from: string | null;
  quiet_to: string | null;
}

interface TargetRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

/**
 * Writes the notices of one company as the notify worker (`notifications.send`), through
 * `app.write_notices()`: each person's choice for the kind decides whether it shows in the centre
 * (a kind turned off there is written read, so only a repeat is stopped) and whether it is pushed
 * now (`pushPlan`: off, no browser, held in quiet hours, or sent to every browser of theirs). A
 * notice the person already had for the same reason, or one for someone who may not receive it in
 * the company, is not written and not answered. One audit row counts what was written.
 */
export async function writeNotices(
  ctx: CommandContext,
  entityId: number,
  drafts: readonly NoticeDraft[],
): Promise<WrittenNoticeDto[]> {
  if (drafts.length === 0) return [];
  const users = [...new Set(drafts.map((d) => d.userId))];
  const [settings, targets] = await Promise.all([
    ctx.tx.execute(
      sql`select * from app.notice_settings(${entityId}::smallint, ${uuidArray(users)}::uuid[])`,
    ) as unknown as Promise<SettingRow[]>,
    ctx.tx.execute(
      sql`select * from app.notice_push_targets(${entityId}::smallint, ${uuidArray(users)}::uuid[])`,
    ) as unknown as Promise<TargetRow[]>,
  ]);
  const rows: NoticeSettingRow[] = settings.map((s) => ({
    userId: s.user_id,
    type: s.type,
    inApp: s.in_app,
    push: s.push,
    quietFrom: s.quiet_from,
    quietTo: s.quiet_to,
  }));
  const planned = drafts.map((draft) => {
    const choice = choiceFor(rows, draft.userId, draft.type);
    const browsers = targets.filter((t) => t.user_id === draft.userId);
    return {
      draft,
      id: newId(),
      inApp: choice.inApp,
      push: pushPlan(choice, browsers.length, ctx.now),
      browsers,
    };
  });
  const written = (await ctx.tx.execute(
    sql`select * from app.write_notices(${entityId}::smallint, ${JSON.stringify(
      planned.map((p) => ({
        id: p.id,
        user_id: p.draft.userId,
        type: p.draft.type,
        subject_type: p.draft.subjectType,
        subject_id: p.draft.subjectId,
        payload: p.draft.payload,
        dedupe_key: p.draft.dedupeKey,
        in_app: p.inApp,
        push: p.push === 'send' ? 'pending' : p.push,
      })),
    )}::jsonb)`,
  )) as unknown as { id: string }[];
  const kept = new Set(written.map((w) => w.id));
  const notices = planned
    .filter((p) => kept.has(p.id))
    .map((p) => ({
      id: p.id,
      userId: p.draft.userId,
      type: p.draft.type,
      entityId,
      payload: p.draft.payload,
      subjectId: p.draft.subjectId,
      push: p.push,
      targets:
        p.push === 'send'
          ? p.browsers.map((b) => ({ endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth }))
          : [],
    }));
  if (notices.length > 0) {
    ctx.audit({
      aggregateType: 'notice_batch',
      aggregateId: newId(),
      entityId,
      before: null,
      after: { notices: notices.length },
    });
  }
  return notices;
}
