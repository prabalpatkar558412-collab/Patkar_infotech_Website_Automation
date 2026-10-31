-- Integration checks: run in Supabase SQL editor after migrations and creating the first Admin.
-- Everything rolls back. This exercises the actual deduplication and cancellation functions.
begin;
do $$
declare cid uuid;lid uuid;wid uuid;jid uuid;first_result boolean;repeat_result boolean;n int;
begin
 if not exists(select 1 from public.profiles where role='Admin') then raise exception 'Create an Admin profile before running integration checks';end if;
 select public.ingest_whatsapp('integration-message-unique',jsonb_build_object('name','Integration Contact','message',jsonb_build_object('id','integration-message-unique','from','919000000001','timestamp',extract(epoch from now())::bigint::text,'type','text','text',jsonb_build_object('body','Hello')))) into first_result;
 select public.ingest_whatsapp('integration-message-unique',jsonb_build_object('message',jsonb_build_object('id','integration-message-unique'))) into repeat_result;
 if first_result is distinct from true or repeat_result is distinct from false then raise exception 'Webhook event deduplication failed';end if;
 select count(*) into n from public.messages where wa_id='integration-message-unique';if n<>1 then raise exception 'Duplicate message inserted';end if;
 select id,lead_id into cid,lid from public.records where kind='conversations' and data->>'phone'='919000000001';
 insert into public.records(kind,data) values('workflows','{"name":"Integration","enabled":true,"delay":60,"template":"test","trigger":"payment"}') returning id into wid;
 insert into public.jobs(workflow_id,conversation_id,related_id,run_at,idempotency_key) values(wid,cid,lid,now(),'integration-job') returning id into jid;
 perform public.ingest_whatsapp('integration-reply-unique',jsonb_build_object('message',jsonb_build_object('id','integration-reply-unique','from','919000000001','timestamp',extract(epoch from now())::bigint::text,'type','text','text',jsonb_build_object('body','STOP'))));
 if (select status from public.jobs where id=jid)<>'cancelled' then raise exception 'Reply did not cancel scheduled automation';end if;
 if (select data->>'opt_out' from public.records where id=cid)<>'true' then raise exception 'Opt-out not persisted';end if;
 raise notice 'PASS: actual webhook deduplication, reply cancellation and opt-out';
end$$;
rollback;
