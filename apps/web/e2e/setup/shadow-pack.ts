// The shadow review pack journey's rows (`e2e/shadow-pack.spec.ts`, docs/03-roadmap-appendix/phase2.md
// §8.1), written by the seed on the host after every other journey's: a customer of company 2 with
// its lead and WhatsApp chat, and in one week of June 2025 the WhatsApp Concierge's and the Caller
// Co-pilot's proposals on it, their runs, a hand-off, and what a person did after them (a reply, the
// facts, a callback of their own, decisions). Written once with fixed ids and kept (runs, actions,
// messages and the audit trail are append-only), so a second seed changes nothing; no other journey
// reads or writes the customer or that week, so the reports opened at that week show the same
// figures whichever journeys ran first. Nothing reaches a vendor.
import {
  AGENT_PRINCIPAL_IDS,
  CONCIERGE_ACTION_TYPES,
  COPILOT_ACTION_TYPES,
  SYSTEM_WORKERS_PRINCIPAL_ID,
} from '@shakti/contracts';
import { asMigrator, PIPELINE_SEED, stageId } from '@shakti/db/testing';
import { SHADOW_PACK } from '../shadow-pack-fixtures';
import { WHATSAPP_QUOTES } from '../support/users';

const ENTITY = SHADOW_PACK.company.entityId;
const CONCIERGE = AGENT_PRINCIPAL_IDS['agent:concierge'];
const COPILOT = AGENT_PRINCIPAL_IDS['agent:copilot'];

/** The journey's fixed ids: `01a3c0de-0000-7000-8000-0000000004NN`. */
const id = (n: number) => `01a3c0de-0000-7000-8000-0000000004${n.toString(16).padStart(2, '0')}`;
const IDS = {
  contact: id(1),
  phone: id(2),
  account: id(3),
  accountEntity: id(4),
  lead: id(5),
  thread: id(6),
  asked: id(16),
  sent: id(17),
  askedAgain: id(18),
  task: id(64),
  taskAudit: id(65),
  factsAudit: id(66),
  handOffAudit: id(67),
} as const;

/** A moment of Tuesday 3 June 2025 in India. */
const at = (time: string) => new Date(`2025-06-03T${time}:00+05:30`).toISOString();

export async function ensureShadowPackJourney(executiveId: string): Promise<void> {
  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('pipeline seed missing');
  await asMigrator(async (m) => {
    const [channel] = await m<{ id: string }[]>`
      select id from entity_channels
       where entity_id = ${ENTITY} and channel = 'whatsapp' and is_active`;
    if (channel === undefined) throw new Error('company 2 has no WhatsApp number for the journey');

    // The customer, its lead (the Executive's) and its chat with the company.
    await m`insert into contacts (id, name, created_by)
            values (${IDS.contact}, ${SHADOW_PACK.customer}, ${executiveId}) on conflict do nothing`;
    await m`insert into contact_phones (id, contact_id, e164, is_primary, is_whatsapp, created_by)
            values (${IDS.phone}, ${IDS.contact}, ${SHADOW_PACK.phone}, true, true, ${executiveId})
            on conflict do nothing`;
    await m`insert into accounts (id, type, name, created_by)
            values (${IDS.account}, 'farm', ${SHADOW_PACK.customer}, ${executiveId})
            on conflict do nothing`;
    await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
            values (${IDS.accountEntity}, ${IDS.account}, ${ENTITY}, ${executiveId}, ${executiveId})
            on conflict do nothing`;
    await m`insert into account_contacts (account_id, contact_id, role, created_by)
            values (${IDS.account}, ${IDS.contact}, 'owner', ${executiveId}) on conflict do nothing`;
    await m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id,
                                       created_by, created_at)
            values (${IDS.lead}, ${ENTITY}, ${IDS.account}, ${pipeline.id}, ${stageId(1, 1)},
                    ${executiveId}, ${executiveId}, ${at('09:00')})
            on conflict do nothing`;
    // With the team since the hand-off below.
    await m`insert into whatsapp_threads (id, entity_id, channel_id, wa_id, account_id, contact_phone_id,
                                          opportunity_id, handled_by, handoff_reason, handed_off_at,
                                          last_inbound_at, created_by)
            values (${IDS.thread}, ${ENTITY}, ${channel.id}, ${SHADOW_PACK.phone.slice(1)},
                    ${IDS.account}, ${IDS.phone}, ${IDS.lead}, 'people', 'question', ${at('11:31')},
                    ${at('11:30')}, ${executiveId})
            on conflict do nothing`;

    // The chat: the customer's question, a person's answer, the customer's next question.
    const inbound = (messageId: string, time: string, body: string) =>
      m`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, provider_message_id,
                                       body_masked, created_at)
        values (${messageId}, ${ENTITY}, ${IDS.thread}, 'inbound', 'text', ${`wamid.e2e.${messageId}`},
                ${body}, ${at(time)})
        on conflict do nothing`;
    await inbound(IDS.asked, '10:00', SHADOW_PACK.asked);
    await m`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, body_masked,
                                           status, sent_by, created_at)
            values (${IDS.sent}, ${ENTITY}, ${IDS.thread}, 'outbound', 'text', ${SHADOW_PACK.sent},
                    'queued', ${executiveId}, ${at('10:20')})
            on conflict do nothing`;
    // Sent long ago: no worker picks it up.
    await m`update whatsapp_messages set status = 'sent', status_at = ${at('10:20')}
             where id = ${IDS.sent} and created_at = ${at('10:20')} and status = 'queued'`;
    await inbound(IDS.askedAgain, '11:30', SHADOW_PACK.askedAgain);

    // What a person did after the proposals: the power needed recorded, a callback of their own
    // (its request ran crm.task.create alone).
    await m`insert into lead_qualifications (opportunity_id, entity_id, required_hp, updated_by,
                                             created_at, updated_at)
            values (${IDS.lead}, ${ENTITY}, 5, ${executiveId}, ${at('10:25')}, ${at('10:25')})
            on conflict do nothing`;
    await m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind, due_at,
                               created_at, created_by)
            values (${IDS.task}, ${ENTITY}, ${IDS.lead}, ${IDS.account}, ${executiveId}, 'callback',
                    ${at('16:00')}, ${at('10:30')}, ${executiveId})
            on conflict do nothing`;
    const audit = (row: {
      id: string;
      time: string;
      actor: string;
      kind: 'user' | 'system';
      command: string;
      type: string;
      aggregate: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    }) =>
      m`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command, aggregate_type,
                                aggregate_id, outcome, before_json, after_json, request_id,
                                created_at)
        values (${row.id}, ${ENTITY}, ${row.actor}, ${row.kind}, ${row.command}, ${row.type},
                ${row.aggregate}, 'ok', ${row.before === undefined ? null : m.json(row.before)},
                ${row.after === undefined ? null : m.json(row.after)},
                ${`e2e-shadow-pack-${row.id}`}, ${at(row.time)})
        on conflict do nothing`;
    await audit({
      id: IDS.factsAudit,
      time: '10:25',
      actor: executiveId,
      kind: 'user',
      command: 'crm.lead.qualification.set',
      type: 'opportunity',
      aggregate: IDS.lead,
      before: { requiredHp: null },
      after: { requiredHp: 5 },
    });
    await audit({
      id: IDS.taskAudit,
      time: '10:30',
      actor: executiveId,
      kind: 'user',
      command: 'crm.task.create',
      type: 'task',
      aggregate: IDS.task,
    });
    // The assistant's rules handed the chat to the team on the price question.
    await audit({
      id: IDS.handOffAudit,
      time: '11:31',
      actor: SYSTEM_WORKERS_PRINCIPAL_ID,
      kind: 'system',
      command: 'messaging.thread.record_hand_off',
      type: 'whatsapp_thread',
      aggregate: IDS.thread,
      before: { handledBy: 'assistant', handoffReason: null },
      after: { handledBy: 'people', handoffReason: 'question' },
    });

    // The agents' runs and proposals.
    const proposal = async (row: {
      run: number;
      agent: 'agent:concierge' | 'agent:copilot';
      type: string;
      time: string;
      cost: number;
      filtered?: string;
      action?: {
        input: Record<string, unknown>;
        state: 'shadowed' | 'approved' | 'rejected';
      };
    }) => {
      const principal = row.agent === 'agent:concierge' ? CONCIERGE : COPILOT;
      const outcome = row.filtered === undefined ? 'shadowed' : 'filtered';
      await m`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, model,
                                      cost_paise, outcome, filter_reason, request_id, created_at)
              values (${id(row.run)}, ${ENTITY}, ${row.agent}, ${principal}, 'e2e_shadow_pack',
                      ${row.type}, 'claude-sonnet-5-5', ${row.cost}, ${outcome},
                      ${row.filtered ?? null}, ${`e2e-shadow-pack-${id(row.run)}`}, ${at(row.time)})
              on conflict do nothing`;
      const action = row.action;
      if (action === undefined) return;
      const decided = action.state !== 'shadowed';
      await m`insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json,
                                         autonomy, state, decided_by, decided_at, created_at,
                                         created_by)
              values (${id(row.run + 1)}, ${ENTITY}, ${id(row.run)}, ${row.agent}, ${row.type},
                      ${m.json(action.input)}, ${decided ? 'needs_approval' : 'shadow'},
                      ${action.state}, ${decided ? executiveId : null},
                      ${decided ? at('12:00') : null}, ${at(row.time)}, ${principal})
              on conflict do nothing`;
    };
    const reply = (body: string) => ({
      entityId: ENTITY,
      threadId: IDS.thread,
      accountId: IDS.account,
      body,
    });
    const onLead = { entityId: ENTITY, opportunityId: IDS.lead };
    // The Concierge: two replies (a person answered after the first), the facts and a callback the
    // person bore out, and an answer the checks refused: ₹14.00 on five runs.
    await proposal({
      run: 32,
      agent: 'agent:concierge',
      type: CONCIERGE_ACTION_TYPES.reply,
      time: '10:01',
      cost: 400,
      action: { input: reply(SHADOW_PACK.drafts[0]), state: 'shadowed' },
    });
    await proposal({
      run: 34,
      agent: 'agent:concierge',
      type: CONCIERGE_ACTION_TYPES.qualification,
      time: '10:01',
      cost: 200,
      action: { input: { ...onLead, facts: { requiredHp: 5 } }, state: 'shadowed' },
    });
    await proposal({
      run: 36,
      agent: 'agent:concierge',
      type: CONCIERGE_ACTION_TYPES.callback,
      time: '10:01',
      cost: 100,
      action: {
        input: { ...onLead, kind: 'callback', dueAt: at('16:00'), assigneeId: executiveId },
        state: 'shadowed',
      },
    });
    await proposal({
      run: 38,
      agent: 'agent:concierge',
      type: CONCIERGE_ACTION_TYPES.reply,
      time: '11:00',
      cost: 400,
      action: { input: reply(SHADOW_PACK.drafts[1]), state: 'shadowed' },
    });
    await proposal({
      run: 40,
      agent: 'agent:concierge',
      type: CONCIERGE_ACTION_TYPES.reply,
      time: '11:05',
      cost: 300,
      filtered: 'reply_too_long',
    });
    // The Co-pilot: a follow-up nobody set (open), a template a person rejected and a follow-up a
    // person approved: ₹3.00 on three runs.
    await proposal({
      run: 48,
      agent: 'agent:copilot',
      type: COPILOT_ACTION_TYPES.followUp,
      time: '10:05',
      cost: 100,
      action: {
        input: {
          ...onLead,
          kind: 'follow_up',
          dueAt: new Date('2025-06-04T11:00:00+05:30').toISOString(),
          assigneeId: executiveId,
          title: 'Ask about the borewell depth',
        },
        state: 'shadowed',
      },
    });
    await proposal({
      run: 50,
      agent: 'agent:copilot',
      type: COPILOT_ACTION_TYPES.template,
      time: '10:06',
      cost: 100,
      action: {
        input: {
          ...onLead,
          occasion: 'nurture',
          templateName: WHATSAPP_QUOTES.templates.quote.name,
        },
        state: 'rejected',
      },
    });
    await proposal({
      run: 52,
      agent: 'agent:copilot',
      type: COPILOT_ACTION_TYPES.followUp,
      time: '10:07',
      cost: 100,
      action: {
        input: {
          ...onLead,
          kind: 'follow_up',
          dueAt: new Date('2025-06-05T11:00:00+05:30').toISOString(),
          assigneeId: executiveId,
          title: 'Send the pump brochure',
        },
        state: 'approved',
      },
    });
  });
}
