-- Additive hardening; preserves all existing records. Apply after 003.
begin;
-- Make privileges explicit rather than relying on project default grants.
revoke all on public.profiles,public.records from anon;
grant select,insert,update,delete on public.records to authenticated;
grant select,insert,update,delete on public.profiles to authenticated;
grant usage on schema public to authenticated,service_role;
grant all on public.profiles,public.records,public.messages,public.jobs,public.webhook_events,public.audit_log,public.quotation_versions to service_role;
grant usage,select on all sequences in schema public to service_role;
-- Anonymous callers cannot invoke conversion or role helpers.
revoke all on function public.convert_lead(uuid),public.user_role(),public.can_record(text,uuid) from public,anon;
grant execute on function public.convert_lead(uuid),public.user_role(),public.can_record(text,uuid) to authenticated,service_role;
create or replace function public.validate_record() returns trigger language plpgsql security definer set search_path=public as $$
declare parent records; p numeric; paid numeric;
begin
 if TG_OP='UPDATE' and (new.kind<>old.kind or new.id<>old.id) then raise exception 'Record type cannot change'; end if;
 if new.lead_id is not null then select * into parent from records where id=new.lead_id; if parent.id is null or parent.kind<>'leads' or (auth.uid() is not null and not can_record(parent.kind,parent.assigned_to)) then raise exception 'Invalid lead permission'; end if; end if;
 if new.project_id is not null then select * into parent from records where id=new.project_id for update; if parent.id is null or parent.kind<>'projects' or (auth.uid() is not null and not can_record(parent.kind,parent.assigned_to)) then raise exception 'Invalid project permission'; end if; end if;
 if new.kind='payments' then
  if jsonb_typeof(new.data->'amount') is distinct from 'number' then raise exception 'Payment amount must be numeric';end if;
  if new.data->>'project_id' is distinct from new.project_id::text then raise exception 'Payment project reference mismatch';end if;
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

-- Prevent deleting approved quotations through direct REST access.
create or replace function public.guard_quotation_delete() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if old.kind='quotations' and old.data->>'status' is distinct from 'Draft'
 and auth.uid() is not null and public.user_role() is distinct from 'Admin'
 then raise exception 'Admin permission required to delete approved quotations';end if;
 return old;
end$$;
create trigger records_delete_permission before delete on public.records
 for each row execute function public.guard_quotation_delete();
commit;
