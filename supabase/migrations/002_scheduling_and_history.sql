create table public.quotation_versions(id bigint generated always as identity primary key,quotation_id uuid not null references public.records(id) on delete cascade,version jsonb not null,actor uuid,created_at timestamptz default now());
alter table quotation_versions enable row level security;
create policy quote_history_read on quotation_versions for select to authenticated using(exists(select 1 from records r where r.id=quotation_id and can_record(r.kind,r.assigned_to)));
create index quotation_versions_quote on quotation_versions(quotation_id,created_at);
create or replace function public.restrict_notes() returns trigger language plpgsql security definer set search_path=public as $$
declare c records;begin
 if new.kind='notes' and new.data ? 'conversation_id' then select * into c from records where id=(new.data->>'conversation_id')::uuid and kind='conversations';
 if c.id is null or (auth.uid() is not null and not can_record(c.kind,c.assigned_to)) then raise exception 'Conversation permission required';end if;end if;
 if new.kind='quotations' then insert into quotation_versions(quotation_id,version,actor) values(new.id,new.data,auth.uid());end if;
 return new;end$$;
create trigger records_versions after insert or update on records for each row execute function restrict_notes();
create or replace function public.schedule_workflows() returns trigger language plpgsql security definer set search_path=public as $$
declare w records;c records;tr text;begin
 if new.kind='conversations' and (TG_OP='INSERT' or (new.data->>'consent'='true' and old.data->>'consent' is distinct from 'true')) then tr='enquiry';c=new;
 elsif new.kind='leads' and TG_OP='UPDATE' and new.data->>'stage' is distinct from old.data->>'stage' then
 tr=case new.data->>'stage' when 'Contacted' then 'requirements' when 'Quotation Sent' then 'quotation' else null end;
 elsif new.kind='quotations' and new.data->>'status'='Approved' and (TG_OP='INSERT' or old.data->>'status' is distinct from 'Approved') then tr='quotation';
 elsif new.kind='projects' and TG_OP='INSERT' then tr='advance';
 elsif new.kind='projects' and TG_OP='UPDATE' and (new.data->>'stage' is distinct from old.data->>'stage' or new.data->>'progress' is distinct from old.data->>'progress') then tr='milestone';end if;
 if tr is null then return new;end if;
 if c.id is null then select * into c from records where kind='conversations' and lead_id=new.lead_id limit 1;
 if new.kind='leads' then select * into c from records where kind='conversations' and lead_id=new.id limit 1;end if;end if;
 if c.id is null or c.data->>'consent' is distinct from 'true' or c.data->>'opt_out'='true' or c.data->>'handover'='true' then return new;end if;
 -- Only approved quotation records can trigger automated quotation sending.
 if tr='quotation' and (new.kind<>'quotations' or new.data->>'status'<>'Approved') then return new;end if;
 for w in select * from records where kind='workflows' and data->>'trigger'=tr and data->>'enabled'='true' loop
 insert into jobs(workflow_id,conversation_id,related_id,snapshot,run_at,idempotency_key)
 values(w.id,c.id,new.id,jsonb_build_object('updated_at',new.updated_at),now()+make_interval(mins=>(w.data->>'delay')::int),w.id::text||'-'||c.id::text||'-'||new.id::text||'-'||new.updated_at::text) on conflict(idempotency_key) do nothing;
 end loop;return new;end$$;
create trigger records_schedule after insert or update on records for each row execute function schedule_workflows();
-- Explicit grants: privileged ingestion and queue mutation are server-only.
revoke all on public.webhook_events from anon,authenticated;
revoke insert,update,delete on public.messages,public.jobs,public.audit_log,public.quotation_versions from anon,authenticated;
grant select on public.jobs,public.messages,public.audit_log,public.quotation_versions to authenticated;
create or replace function public.audit_message() returns trigger language plpgsql security definer set search_path=public as $$begin insert into audit_log(actor,action,record_id,detail) values(auth.uid(),'message_'||lower(TG_OP),new.conversation_id,jsonb_build_object('message_id',new.id,'direction',new.direction,'status',new.status));return new;end$$;
create trigger messages_audit after insert or update on messages for each row execute function audit_message();
