-- SPIKE ONLY. Lets a BOS Realtime token send a broadcast on its own `user:{sub}` channel, so the
-- spike script can time a broadcast from send to receipt. Apply to the hosted dev project after
-- realtime-policies.sql, run the spike, then run the `drop policy` line at the bottom. Production
-- never has this policy: broadcasts come from the notify worker after commit (ADR 0005).

create policy bos_spike_self_send
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and (select bos_realtime.claims_ok())
  and (select realtime.topic()) = 'user:' || (select auth.jwt() ->> 'sub')
);

-- After the spike:
-- drop policy bos_spike_self_send on realtime.messages;
