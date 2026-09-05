-- Prevent asynchronous job producers from recreating data for deleted accounts.
-- Account deletion intentionally leaves account_tombstones as the durable write barrier.

create or replace function public.enforce_json_payload_account_tombstone()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
    if (new.payload->>'userId') is not null
       and exists (
           select 1
           from public.account_tombstones
           where user_id = (new.payload->>'userId')::uuid
       ) then
        raise exception 'ACCOUNT_TOMBSTONE_VIOLATION: Cannot write job data for deleted user %', new.payload->>'userId';
    end if;

    if (new.payload->>'user_id') is not null
       and exists (
           select 1
           from public.account_tombstones
           where user_id = (new.payload->>'user_id')::uuid
       ) then
        raise exception 'ACCOUNT_TOMBSTONE_VIOLATION: Cannot write job data for deleted user %', new.payload->>'user_id';
    end if;

    return new;
end;
$function$;

drop trigger if exists tr_enforce_tombstone_background_jobs on public.background_jobs;
create trigger tr_enforce_tombstone_background_jobs
before insert or update on public.background_jobs
for each row execute function public.enforce_json_payload_account_tombstone();

drop trigger if exists tr_enforce_tombstone_failed_jobs on public.failed_jobs;
create trigger tr_enforce_tombstone_failed_jobs
before insert or update on public.failed_jobs
for each row execute function public.enforce_json_payload_account_tombstone();

-- These user-owned tables were missing the write barrier in the live schema.
drop trigger if exists tr_enforce_tombstone_nova_thoughts on public.nova_thoughts;
create trigger tr_enforce_tombstone_nova_thoughts
before insert or update on public.nova_thoughts
for each row execute function public.enforce_account_tombstone('user_id');

drop trigger if exists tr_enforce_tombstone_reminders on public.reminders;
create trigger tr_enforce_tombstone_reminders
before insert or update on public.reminders
for each row execute function public.enforce_account_tombstone('user_id');

drop trigger if exists tr_enforce_tombstone_telemetry_events on public.telemetry_events;
create trigger tr_enforce_tombstone_telemetry_events
before insert or update on public.telemetry_events
for each row execute function public.enforce_account_tombstone('user_id');

drop trigger if exists tr_enforce_tombstone_user_presence_history on public.user_presence_history;
create trigger tr_enforce_tombstone_user_presence_history
before insert or update on public.user_presence_history
for each row execute function public.enforce_account_tombstone('user_id');
