-- Apply after 001 and 002. Transactional ingestion and deduplication.
create or replace function public.ingest_whatsapp(event_key text,event jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare c records;leadrow records;m jsonb;s jsonb;phone text;contact_name text;owner uuid;stopped boolean;
begin
 insert into webhook_events values(event_key,event,now()) on conflict do nothing;if not found then return false;end if;
 if event ? 'message' then
 m=event->'message';phone=m->>'from';contact_name=coalesce(event->>'name',phone);stopped=lower(trim(m->'text'->>'body')) in ('stop','unsubscribe','cancel');
 select id into owner from profiles where role='Admin' limit 1;
 -- Serialize first-contact creation across simultaneous messages from one sender.
 perform pg_advisory_xact_lock(hashtextextended('whatsapp:'||phone,0));
 if exists(select 1 from messages where wa_id=m->>'id') then return false;end if;
 select * into c from records where kind='conversations' and data->>'phone'=phone for update;
 if c.id is null then
 insert into records(kind,assigned_to,data) values('leads',owner,jsonb_build_object('name',contact_name,'phone',phone,'email','','stage','New','service','Website','budget',0,'source','WhatsApp','requirements',coalesce(m->'text'->>'body','Attachment enquiry'))) returning * into leadrow;
 insert into records(kind,assigned_to,lead_id,data) values('conversations',owner,leadrow.id,jsonb_build_object('name',contact_name,'phone',phone,'consent',false,'opt_out',stopped,'last_inbound',to_timestamp((m->>'timestamp')::bigint),'unread',1,'preview',coalesce(m->'text'->>'body','Attachment'))) returning * into c;
 else update records set data=data||jsonb_build_object('last_inbound',to_timestamp((m->>'timestamp')::bigint),'opt_out',coalesce((data->>'opt_out')::boolean,false) or coalesce(stopped,false),'unread',coalesce((data->>'unread')::int,0)+1,'preview',coalesce(m->'text'->>'body','Attachment')) where id=c.id;end if;
 insert into messages(conversation_id,direction,body,status,wa_id) values(c.id,'in',coalesce(m->'text'->>'body','['||(m->>'type')||' attachment]'),'received',m->>'id') on conflict(wa_id) do nothing;
 update jobs set status='cancelled',error='Customer replied or opted out' where conversation_id=c.id and status in ('pending','retry');
 elsif event ? 'status' then s=event->'status';
 update messages set status=s->>'status' where wa_id=s->>'id' and (s->>'status'='failed' or case s->>'status' when 'read' then 4 when 'delivered' then 3 when 'sent' then 2 else 0 end > case status when 'read' then 4 when 'delivered' then 3 when 'sent' then 2 else 1 end);
 if not exists(select 1 from messages where wa_id=s->>'id') then
 -- Roll back receipt so Meta retries a status racing the outbound commit.
 raise exception 'Status has no matching committed outbound message';
 end if;
 end if;return true;end$$;
revoke all on function public.ingest_whatsapp(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_whatsapp(text,jsonb) to service_role;
