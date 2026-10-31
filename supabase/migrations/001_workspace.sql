-- Run once in a fresh Supabase project. Never expose the service-role key.
create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users on delete cascade,name text not null,role text not null check(role in ('Admin','Sales','Developer')));
create table public.records(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('leads','clients','quotations','projects','tasks','payments','conversations','notes','workflows','settings','templates')),data jsonb not null,assigned_to uuid references public.profiles(id),lead_id uuid references public.records(id) on delete restrict,project_id uuid references public.records(id) on delete restrict,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index records_kind on public.records(kind);
create index records_owner on public.records(assigned_to,kind);
create index records_lead on public.records(lead_id);
create index records_project on public.records(project_id);
create unique index conversation_phone on public.records((data->>'phone')) where kind='conversations';
create unique index converted_client on public.records(lead_id) where kind='clients';
create unique index converted_project on public.records(lead_id) where kind='projects';
create table public.messages(id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.records(id),direction text not null check(direction in ('in','out')),body text not null,status text not null default 'received',wa_id text unique,idempotency_key text unique,error text,created_at timestamptz not null default now());
create index messages_conversation on public.messages(conversation_id,created_at);
create table public.webhook_events(event_key text primary key,payload jsonb not null,created_at timestamptz default now());
create table public.jobs(id uuid primary key default gen_random_uuid(),workflow_id uuid not null references public.records(id),conversation_id uuid not null references public.records(id),related_id uuid not null references public.records(id),snapshot jsonb not null default '{}',status text not null default 'pending' check(status in ('pending','processing','completed','cancelled','retry','review','failed')),attempts int not null default 0,run_at timestamptz not null,locked_at timestamptz,error text,idempotency_key text unique not null,created_at timestamptz not null default now());
create index jobs_due on public.jobs(status,run_at);
create table public.audit_log(id bigint generated always as identity primary key,actor uuid,action text not null,record_id uuid,detail jsonb,created_at timestamptz default now());
create or replace function public.user_role() returns text language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid()$$;
create or replace function public.can_record(k text,owner uuid) returns boolean language sql stable security definer set search_path=public as $$select user_role()='Admin' or (owner=auth.uid() and ((user_role()='Sales' and k in ('leads','clients','quotations','conversations','notes')) or (user_role()='Developer' and k in ('projects','tasks','notes'))))$$;
alter table profiles enable row level security;
alter table records enable row level security;
alter table messages enable row level security;
alter table webhook_events enable row level security;
alter table jobs enable row level security;
alter table audit_log enable row level security;
create policy profiles_read on profiles for select to authenticated using(true);
create policy profiles_admin on profiles for all to authenticated using(user_role()='Admin') with check(user_role()='Admin');
create policy records_access on records for all to authenticated using(can_record(kind,assigned_to)) with check(can_record(kind,assigned_to));
create policy messages_read on messages for select to authenticated using(exists(select 1 from records r where r.id=conversation_id and can_record(r.kind,r.assigned_to)));
create policy jobs_read on jobs for select to authenticated using(user_role()='Admin');
create policy audit_read on audit_log for select to authenticated using(user_role()='Admin');
create or replace function public.validate_record() returns trigger language plpgsql security definer set search_path=public as $$
declare parent records; p numeric; paid numeric;
begin
 if TG_OP='UPDATE' and (new.kind<>old.kind or new.id<>old.id) then raise exception 'Record type cannot change'; end if;
 if new.lead_id is not null then select * into parent from records where id=new.lead_id; if parent.kind<>'leads' or (auth.uid() is not null and not can_record(parent.kind,parent.assigned_to)) then raise exception 'Invalid lead permission'; end if; end if;
 if new.project_id is not null then select * into parent from records where id=new.project_id for update; if parent.kind<>'projects' or (auth.uid() is not null and not can_record(parent.kind,parent.assigned_to)) then raise exception 'Invalid project permission'; end if; end if;
 if new.kind='payments' then
  if new.project_id is null or (new.data->>'amount')::numeric<=0 then raise exception 'Payment requires a project and positive amount'; end if;
  select coalesce(sum((data->>'amount')::numeric),0) into paid from records where kind='payments' and project_id=new.project_id and id<>new.id;
  if paid+(new.data->>'amount')::numeric > (parent.data->>'value')::numeric then raise exception 'Payment exceeds outstanding project value'; end if;
 end if;
 if new.kind='projects' then select coalesce(sum((data->>'amount')::numeric),0) into paid from records where kind='payments' and project_id=new.id; if (new.data->>'value')::numeric<paid then raise exception 'Project value is below recorded payments'; end if; end if;
 if new.kind='quotations' and auth.uid() is not null and user_role()<>'Admin' then
  if (TG_OP='INSERT' and new.data->>'status'<>'Draft') or (TG_OP='UPDATE' and (new.data->>'status' is distinct from old.data->>'status' or old.data->>'status'<>'Draft')) then raise exception 'Admin approval permission required'; end if;
 end if;
 new.updated_at=now();return new;
end$$;
create trigger records_validate before insert or update on records for each row execute function validate_record();
create or replace function public.audit_record() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into audit_log(actor,action,record_id,detail) values(auth.uid(),TG_OP,coalesce(new.id,old.id),jsonb_build_object('kind',coalesce(new.kind,old.kind)));
 if TG_OP in ('UPDATE','DELETE') then update jobs set status='cancelled',error='Related record changed' where related_id=old.id and status in ('pending','retry'); end if;
 return coalesce(new,old);end$$;
create trigger records_audit after insert or update or delete on records for each row execute function audit_record();
create or replace function public.convert_lead(lead uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare l records;c records;p records;begin
 select * into l from records where id=lead and kind='leads' for update;
 if l.id is null or l.data->>'stage'<>'Won' then raise exception 'Only a won lead can be converted'; end if;
 if user_role()<>'Admin' then raise exception 'Admin permission required to create project'; end if;
 insert into records(kind,data,assigned_to,lead_id) values('clients',l.data,l.assigned_to,l.id) returning * into c;
 insert into records(kind,data,assigned_to,lead_id) values('projects',jsonb_build_object('name',l.data->>'company'||' project','client',l.data->>'name','scope',l.data->>'requirements','stage','Planning','value',coalesce((l.data->>'budget')::numeric,0),'progress',0),l.assigned_to,l.id) returning * into p;
 return jsonb_build_object('client',c.id,'project',p.id);end$$;
-- Durable queue claiming. Service role only; concurrent workers use SKIP LOCKED.
create or replace function public.claim_jobs() returns setof jobs language sql security definer set search_path=public as $$
 update jobs set status='processing',locked_at=now(),attempts=attempts+1 where id in (select id from jobs where status in ('pending','retry') and run_at<=now() order by run_at for update skip locked limit 20) returning *$$;
revoke all on function public.claim_jobs() from public,anon,authenticated;
grant execute on function public.claim_jobs() to service_role;
create or replace function public.ingest_whatsapp(event_key text,event jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare c records;leadrow records;m jsonb;s jsonb;phone text;contact_name text;owner uuid;stopped boolean;
begin
 insert into webhook_events values(event_key,event,now()) on conflict do nothing;if not found then return false;end if;
 if event ? 'message' then
 m=event->'message';phone=m->>'from';contact_name=coalesce(event->>'name',phone);stopped=lower(trim(m->'text'->>'body')) in ('stop','unsubscribe','cancel');
 select id into owner from profiles where role='Admin' limit 1;
 select * into c from records where kind='conversations' and data->>'phone'=phone for update;
 if c.id is null then
 insert into records(kind,assigned_to,data) values('leads',owner,jsonb_build_object('name',contact_name,'phone',phone,'email','','stage','New','service','Website','budget',0,'source','WhatsApp','requirements',coalesce(m->'text'->>'body','Attachment enquiry'))) returning * into leadrow;
 insert into records(kind,assigned_to,lead_id,data) values('conversations',owner,leadrow.id,jsonb_build_object('name',contact_name,'phone',phone,'consent',false,'opt_out',stopped,'last_inbound',to_timestamp((m->>'timestamp')::bigint),'unread',1,'preview',coalesce(m->'text'->>'body','Attachment'))) returning * into c;
 else update records set data=data||jsonb_build_object('last_inbound',to_timestamp((m->>'timestamp')::bigint),'opt_out',coalesce((data->>'opt_out')::boolean,false) or coalesce(stopped,false),'unread',coalesce((data->>'unread')::int,0)+1,'preview',coalesce(m->'text'->>'body','Attachment')) where id=c.id;end if;
 insert into messages(conversation_id,direction,body,status,wa_id) values(c.id,'in',coalesce(m->'text'->>'body','['||(m->>'type')||' attachment]'),'received',m->>'id') on conflict(wa_id) do nothing;
 update jobs set status='cancelled',error='Customer replied or opted out' where conversation_id=c.id and status in ('pending','retry');
 elsif event ? 'status' then s=event->'status';
 update messages set status=s->>'status' where wa_id=s->>'id' and (s->>'status'='failed' or case s->>'status' when 'read' then 4 when 'delivered' then 3 when 'sent' then 2 else 0 end > case status when 'read' then 4 when 'delivered' then 3 when 'sent' then 2 else 1 end);
 end if;return true;end$$;
revoke all on function public.ingest_whatsapp(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_whatsapp(text,jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('workspace-files','workspace-files',false,16777216) on conflict do nothing;
create policy file_read on storage.objects for select to authenticated using(bucket_id='workspace-files' and exists(select 1 from public.records where id::text=(storage.foldername(name))[1] and public.can_record(kind,assigned_to)));
create policy file_insert on storage.objects for insert to authenticated with check(bucket_id='workspace-files' and exists(select 1 from public.records where id::text=(storage.foldername(name))[1] and public.can_record(kind,assigned_to)));
