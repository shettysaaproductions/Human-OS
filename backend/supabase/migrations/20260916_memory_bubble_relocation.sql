-- Canonical memory bubble topology + transactional branch relocation.
-- Applied to production Supabase on 2026-09-16.

create extension if not exists pgcrypto;

create table if not exists public.memory_bubbles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_bubble_id uuid null references public.memory_bubbles(id) on delete restrict,
  label text not null,
  slug text not null,
  bubble_type text not null default 'entity' check (bubble_type in ('domain','entity','branch','attribute')),
  domain_key text,
  relation_type text,
  metadata jsonb not null default '{}'::jsonb,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, parent_bubble_id, slug)
);

create index if not exists idx_memory_bubbles_user_parent on public.memory_bubbles(user_id, parent_bubble_id);
create index if not exists idx_memory_bubbles_user_slug on public.memory_bubbles(user_id, slug);

alter table public.memories add column if not exists bubble_id uuid references public.memory_bubbles(id) on delete set null;
create index if not exists idx_memories_user_bubble on public.memories(user_id, bubble_id) where bubble_id is not null;

alter table public.reminders add column if not exists bubble_id uuid references public.memory_bubbles(id) on delete set null;
create index if not exists idx_reminders_user_bubble on public.reminders(user_id, bubble_id) where bubble_id is not null;

create table if not exists public.memory_bubble_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bubble_id uuid references public.memory_bubbles(id) on delete set null,
  entity_name text not null,
  source_domain text,
  target_domain text not null,
  old_relation text,
  new_relation text,
  memory_ids jsonb not null default '[]'::jsonb,
  reminder_ids jsonb not null default '[]'::jsonb,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  confirmation_fingerprint text,
  created_at timestamptz not null default now()
);

create index if not exists idx_memory_bubble_moves_user_created on public.memory_bubble_moves(user_id, created_at desc);

alter table public.memory_bubbles enable row level security;
alter table public.memory_bubble_moves enable row level security;

create or replace function public.move_memory_branch_atomic(
  p_user_id uuid,
  p_memory_ids uuid[],
  p_reminder_ids uuid[],
  p_entity_name text,
  p_source_domain text,
  p_target_domain text,
  p_old_relation text,
  p_new_relation text,
  p_confirmation_fingerprint text default null,
  p_expected_updated jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := lower(regexp_replace(coalesce(p_entity_name,''), '[^a-zA-Z0-9]+', '_', 'g'));
  v_domain_bubble uuid;
  v_entity_bubble uuid;
  v_existing_bubble uuid;
  v_memory_count integer := 0;
  v_reminder_count integer := 0;
  v_now timestamptz := now();
  v_stale integer := 0;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if p_user_id is null or v_slug = '' or p_target_domain is null or p_target_domain = '' then
    raise exception 'INVALID_BRANCH_MOVE_INPUT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if coalesce(array_length(p_memory_ids, 1), 0) > 0 then
    select count(*) into v_memory_count
    from public.memories
    where user_id = p_user_id and id = any(p_memory_ids) and is_archived = false;
    if v_memory_count <> array_length(p_memory_ids, 1) then
      raise exception 'MEMORY_SET_CHANGED';
    end if;
  end if;

  if coalesce(array_length(p_reminder_ids, 1), 0) > 0 then
    select count(*) into v_reminder_count
    from public.reminders
    where user_id = p_user_id and id = any(p_reminder_ids) and status not in ('cancelled','completed');
    if v_reminder_count <> array_length(p_reminder_ids, 1) then
      raise exception 'REMINDER_SET_CHANGED';
    end if;
  end if;

  if jsonb_typeof(coalesce(p_expected_updated, '[]'::jsonb)) = 'array' then
    select count(*) into v_stale
    from jsonb_to_recordset(coalesce(p_expected_updated, '[]'::jsonb)) as x(id uuid, updated_at timestamptz)
    join public.memories m on m.id = x.id and m.user_id = p_user_id
    where m.updated_at is distinct from x.updated_at;
    if v_stale > 0 then
      raise exception 'STALE_BRANCH_PROPOSAL';
    end if;
  end if;

  select id into v_domain_bubble
  from public.memory_bubbles
  where user_id = p_user_id and parent_bubble_id is null and slug = 'domain:' || lower(p_target_domain) and is_archived = false
  limit 1;

  if v_domain_bubble is null then
    insert into public.memory_bubbles(user_id,parent_bubble_id,label,slug,bubble_type,domain_key,relation_type,metadata,created_at,updated_at)
    values (p_user_id,null,initcap(replace(lower(p_target_domain),'_',' ')),'domain:'||lower(p_target_domain),'domain',lower(p_target_domain),null,'{}'::jsonb,v_now,v_now)
    returning id into v_domain_bubble;
  end if;

  select distinct m.bubble_id into v_existing_bubble
  from public.memories m
  where m.user_id = p_user_id and m.id = any(coalesce(p_memory_ids,'{}'::uuid[])) and m.bubble_id is not null
  limit 1;

  if v_existing_bubble is not null then
    select id into v_entity_bubble
    from public.memory_bubbles
    where id = v_existing_bubble and user_id = p_user_id and is_archived = false;
  end if;

  if v_entity_bubble is null then
    select id into v_entity_bubble
    from public.memory_bubbles
    where user_id=p_user_id and parent_bubble_id=v_domain_bubble and slug='entity:'||v_slug and is_archived=false
    limit 1;
  end if;

  if v_entity_bubble is null then
    insert into public.memory_bubbles(user_id,parent_bubble_id,label,slug,bubble_type,domain_key,relation_type,metadata,created_at,updated_at)
    values (p_user_id,v_domain_bubble,p_entity_name,'entity:'||v_slug,'entity',lower(p_target_domain),p_new_relation,jsonb_build_object('reclassified_at',v_now),v_now,v_now)
    returning id into v_entity_bubble;
  else
    update public.memory_bubbles
      set parent_bubble_id=v_domain_bubble,
          label=p_entity_name,
          domain_key=lower(p_target_domain),
          relation_type=coalesce(p_new_relation,relation_type),
          is_archived=false,
          updated_at=v_now
    where id=v_entity_bubble and user_id=p_user_id;
  end if;

  if coalesce(array_length(p_memory_ids,1),0) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'bubble_id',bubble_id,'memory_type',memory_type,'updated_at',updated_at)),'[]'::jsonb)
      into v_before
    from public.memories where user_id=p_user_id and id=any(p_memory_ids);

    update public.memories
      set bubble_id=v_entity_bubble,
          memory_type=lower(p_target_domain),
          updated_at=v_now
    where user_id=p_user_id and id=any(p_memory_ids);

    insert into public.memory_events(memory_id,user_id,action,old_value,new_value,created_at)
    select m.id,p_user_id,'BRANCH_RELOCATED',coalesce(m.value,''),coalesce(m.value,'') || ' [branch:' || lower(p_target_domain) || ']',v_now
    from public.memories m where m.user_id=p_user_id and m.id=any(p_memory_ids);
  end if;

  if coalesce(array_length(p_reminder_ids,1),0) > 0 then
    update public.reminders
      set bubble_id=v_entity_bubble,
          notes=case when coalesce(notes,'') like '%[Bubble:%' then notes
            else coalesce(notes,'') || case when coalesce(notes,'')='' then '' else ' ' end || '[Bubble: ' || p_entity_name || ']'
          end,
          updated_at=v_now
    where user_id=p_user_id and id=any(p_reminder_ids);
  end if;

  select jsonb_build_object('bubble_id',v_entity_bubble,'domain_bubble_id',v_domain_bubble,'domain',p_target_domain,'relation',p_new_relation)
    into v_after;

  insert into public.memory_bubble_moves(user_id,bubble_id,entity_name,source_domain,target_domain,old_relation,new_relation,memory_ids,reminder_ids,before_state,after_state,confirmation_fingerprint,created_at)
  values (p_user_id,v_entity_bubble,p_entity_name,p_source_domain,p_target_domain,p_old_relation,p_new_relation,to_jsonb(coalesce(p_memory_ids,'{}'::uuid[])),to_jsonb(coalesce(p_reminder_ids,'{}'::uuid[])),v_before,v_after,p_confirmation_fingerprint,v_now);

  return jsonb_build_object('success',true,'bubble_id',v_entity_bubble,'domain_bubble_id',v_domain_bubble,'moved_memory_count',v_memory_count,'moved_reminder_count',v_reminder_count,'target_domain',p_target_domain,'target_relation',p_new_relation);
end;
$$;

revoke all on function public.move_memory_branch_atomic(uuid,uuid[],uuid[],text,text,text,text,text,text,jsonb) from public;
grant execute on function public.move_memory_branch_atomic(uuid,uuid[],uuid[],text,text,text,text,text,text,jsonb) to service_role;
