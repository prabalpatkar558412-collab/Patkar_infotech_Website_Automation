-- Run after 001-004 in SQL editor. All fixtures roll back; existing records are untouched.
begin;
insert into auth.users(id,email) values
 ('f0000000-0000-4000-8000-000000000001','integration-admin@example.invalid'),
 ('f0000000-0000-4000-8000-000000000002','integration-sales@example.invalid'),
 ('f0000000-0000-4000-8000-000000000003','integration-other@example.invalid'),
 ('f0000000-0000-4000-8000-000000000004','integration-dev@example.invalid');
insert into public.profiles(id,name,role) values
 ('f0000000-0000-4000-8000-000000000001','Integration Admin','Admin'),
 ('f0000000-0000-4000-8000-000000000002','Integration Sales','Sales'),
 ('f0000000-0000-4000-8000-000000000003','Other Sales','Sales'),
 ('f0000000-0000-4000-8000-000000000004','Integration Developer','Developer');
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
do $$
declare k text; rid uuid; pid uuid; cid uuid; mid uuid; n int;
begin
 foreach k in array array['leads','clients','conversations','quotations','projects','tasks','payments'] loop
  insert into public.records(kind,assigned_to,project_id,data)
  values(k,'f0000000-0000-4000-8000-000000000002',case when k='payments' then pid end,
   jsonb_build_object('name','Integration record','stage','New','status','Draft','phone','919000000099','value',1000,'amount',100,'project_id',pid)) returning id into rid;
  if k='projects' then pid=rid;end if;
  if k='conversations' then cid=rid;end if;
  update public.records set data=data||'{"integration_updated":true}' where id=rid;
  select count(*) into n from public.records where id=rid and data->>'integration_updated'='true';
  if n<>1 then raise exception 'CRUD failed for %',k;end if;
 end loop;
 -- Store fixture IDs in transaction-local settings for subsequent role checks.
 perform set_config('integration.conversation',cid::text,true);
 perform set_config('integration.project',pid::text,true);
end$$;
reset role;
insert into public.messages(conversation_id,direction,body,status)
values(current_setting('integration.conversation')::uuid,'in','Integration message','received');
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
do $$begin
 if not exists(select 1 from public.records where id=current_setting('integration.conversation')::uuid) then raise exception 'Sales cannot read assigned conversation';end if;
 if not exists(select 1 from public.messages where conversation_id=current_setting('integration.conversation')::uuid) then raise exception 'Sales cannot read assigned messages';end if;
 if exists(select 1 from public.records where id=current_setting('integration.project')::uuid) then raise exception 'Sales can read financial project';end if;
 begin
  update public.profiles set role='Admin' where id=auth.uid();
  if found then raise exception 'Role escalation succeeded';end if;
 exception when insufficient_privilege then null;end;
 begin
  insert into public.records(kind,assigned_to,data) values('leads','f0000000-0000-4000-8000-000000000003','{"name":"Unauthorized"}');
  raise exception 'Cross-owner insert succeeded';
 exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000003',true);
do $$begin
 if exists(select 1 from public.records where id=current_setting('integration.conversation')::uuid) then raise exception 'Other owner can read conversation';end if;
 if exists(select 1 from public.messages where conversation_id=current_setting('integration.conversation')::uuid) then raise exception 'Other owner can read messages';end if;
 update public.records set data=data||'{"hacked":true}' where id=current_setting('integration.conversation')::uuid;
 if found then raise exception 'Cross-owner update succeeded';end if;
end$$;
reset role;
update public.records set assigned_to='f0000000-0000-4000-8000-000000000004' where id=current_setting('integration.project')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000004',true);
do $$begin
 if not exists(select 1 from public.records where id=current_setting('integration.project')::uuid) then raise exception 'Developer cannot read assigned project';end if;
 if exists(select 1 from public.records where id=current_setting('integration.conversation')::uuid) then raise exception 'Developer can read sales conversation';end if;
end$$;
reset role;
set local role anon;
do $$begin
 begin
  perform * from public.records limit 1;
  raise exception 'Anonymous record access succeeded';
 exception when insufficient_privilege then null;end;
 begin
  perform public.ingest_whatsapp('unauthorized','{}');
  raise exception 'Anonymous webhook RPC succeeded';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
rollback;
-- Success means no exception. Rollback intentionally removes all fixtures.
