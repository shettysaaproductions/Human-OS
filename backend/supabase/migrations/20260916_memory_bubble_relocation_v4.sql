-- V4: Canonical memory bubble topology, indexes, bubble_id columns, and atomic branch relocation RPC.

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

create or replace function public.move_memory_branch_atomic_v3(
  p_user_id uuid, p_memory_ids uuid[], p_reminder_ids uuid[], p_entity_name text,
  p_source_domain text, p_target_domain text, p_old_relation text, p_new_relation text,
  p_target_parent_bubble_id uuid default null, p_target_parent_label text default null,
  p_confirmation_fingerprint text default null, p_expected_updated jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_slug text:=lower(regexp_replace(coalesce(p_entity_name,''),'[^a-zA-Z0-9]+','_','g'));
 v_target_parent uuid:=p_target_parent_bubble_id; v_source_bubble uuid; v_entity_bubble uuid; v_domain_bubble uuid;
 v_target_label text:=nullif(trim(coalesce(p_target_parent_label,'')),'');
 v_target_slug text:=lower(regexp_replace(coalesce(v_target_label,''),'[^a-zA-Z0-9]+','_','g'));
 v_now timestamptz:=now(); v_stale int:=0; v_mem_count int:=0; v_rem_count int:=0; v_descendant_count int:=0;
 v_before jsonb:='[]'::jsonb; v_after jsonb:='[]'::jsonb;
begin
 if p_user_id is null or v_slug='' or coalesce(p_target_domain,'')='' then raise exception 'INVALID_BRANCH_MOVE_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select id into v_domain_bubble from memory_bubbles where user_id=p_user_id and parent_bubble_id is null and slug='domain:'||lower(p_target_domain) and is_archived=false limit 1;
 if v_domain_bubble is null then insert into memory_bubbles(user_id,parent_bubble_id,label,slug,bubble_type,domain_key,metadata,created_at,updated_at) values(p_user_id,null,initcap(replace(lower(p_target_domain),'_',' ')),'domain:'||lower(p_target_domain),'domain',lower(p_target_domain),'{}',v_now,v_now) returning id into v_domain_bubble; end if;
 if v_target_parent is not null then
   if not exists(select 1 from memory_bubbles where id=v_target_parent and user_id=p_user_id and is_archived=false) then raise exception 'INVALID_TARGET_BUBBLE'; end if;
 else
   v_target_parent:=v_domain_bubble;
   if v_target_label is not null and v_target_slug<>'' and v_target_slug<>lower(p_target_domain) then
     select id into v_target_parent from memory_bubbles where user_id=p_user_id and parent_bubble_id=v_domain_bubble and slug='branch:'||v_target_slug and is_archived=false limit 1;
     if v_target_parent is null then insert into memory_bubbles(user_id,parent_bubble_id,label,slug,bubble_type,domain_key,relation_type,metadata,created_at,updated_at) values(p_user_id,v_domain_bubble,v_target_label,'branch:'||v_target_slug,'branch',lower(p_target_domain),null,jsonb_build_object('created_for_move',true),v_now,v_now) returning id into v_target_parent; end if;
   end if;
 end if;
 if coalesce(array_length(p_memory_ids,1),0)>0 then
   if exists(select 1 from memories where id=any(p_memory_ids) and user_id<>p_user_id) then raise exception 'MEMORY_OWNERSHIP_MISMATCH'; end if;
   select count(*) into v_stale from jsonb_to_recordset(coalesce(p_expected_updated,'[]')) x(id uuid,updated_at timestamptz) join memories m on m.id=x.id and m.user_id=p_user_id where m.updated_at is distinct from x.updated_at;
   if v_stale>0 then raise exception 'STALE_BRANCH_PROPOSAL'; end if;
   select count(*) into v_mem_count from memories where user_id=p_user_id and id=any(p_memory_ids) and is_archived=false;
   if v_mem_count<>array_length(p_memory_ids,1) then raise exception 'MEMORY_SET_CHANGED'; end if;
 end if;
 if coalesce(array_length(p_reminder_ids,1),0)>0 then select count(*) into v_rem_count from reminders where user_id=p_user_id and id=any(p_reminder_ids) and status not in('cancelled','completed'); if v_rem_count<>array_length(p_reminder_ids,1) then raise exception 'REMINDER_SET_CHANGED'; end if; end if;
 select m.bubble_id into v_source_bubble from memories m where m.user_id=p_user_id and m.id=any(coalesce(p_memory_ids,'{}')) and m.bubble_id is not null order by m.updated_at asc limit 1;
 if v_source_bubble is not null then
   if v_target_parent=v_source_bubble or exists(with recursive d as(select id from memory_bubbles where id=v_source_bubble and user_id=p_user_id union all select b.id from memory_bubbles b join d on b.parent_bubble_id=d.id where b.user_id=p_user_id) select 1 from d where id=v_target_parent) then raise exception 'TARGET_IS_DESCENDANT'; end if;
   with recursive d as(select id from memory_bubbles where id=v_source_bubble and user_id=p_user_id union all select b.id from memory_bubbles b join d on b.parent_bubble_id=d.id where b.user_id=p_user_id) select count(*) into v_descendant_count from d;
   with recursive d as(select id from memory_bubbles where id=v_source_bubble and user_id=p_user_id union all select b.id from memory_bubbles b join d on b.parent_bubble_id=d.id where b.user_id=p_user_id) select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'bubble_id',m.bubble_id,'memory_type',m.memory_type,'updated_at',m.updated_at)),'[]') into v_before from memories m where m.user_id=p_user_id and m.bubble_id in(select id from d);
   with recursive d as(select id from memory_bubbles where id=v_source_bubble and user_id=p_user_id union all select b.id from memory_bubbles b join d on b.parent_bubble_id=d.id where b.user_id=p_user_id) update memory_bubbles b set parent_bubble_id=case when b.id=v_source_bubble then v_target_parent else b.parent_bubble_id end,domain_key=lower(p_target_domain),relation_type=case when b.id=v_source_bubble then coalesce(p_new_relation,b.relation_type) else b.relation_type end,updated_at=v_now where b.id in(select id from d);
   with recursive d as(select id from memory_bubbles where id=v_source_bubble and user_id=p_user_id union all select b.id from memory_bubbles b join d on b.parent_bubble_id=d.id where b.user_id=p_user_id) update memories set memory_type=lower(p_target_domain),updated_at=v_now where user_id=p_user_id and bubble_id in(select id from d);
   select v_source_bubble into v_entity_bubble;
 else
   select id into v_entity_bubble from memory_bubbles where user_id=p_user_id and parent_bubble_id=v_target_parent and slug='entity:'||v_slug and is_archived=false limit 1;
   if v_entity_bubble is null then insert into memory_bubbles(user_id,parent_bubble_id,label,slug,bubble_type,domain_key,relation_type,metadata,created_at,updated_at) values(p_user_id,v_target_parent,p_entity_name,'entity:'||v_slug,'entity',lower(p_target_domain),p_new_relation,'{"created_from_reclassification":true}',v_now,v_now) returning id into v_entity_bubble; else update memory_bubbles set label=p_entity_name,domain_key=lower(p_target_domain),relation_type=coalesce(p_new_relation,relation_type),is_archived=false,updated_at=v_now where id=v_entity_bubble; end if;
   if coalesce(array_length(p_memory_ids,1),0)>0 then update memories set bubble_id=v_entity_bubble,memory_type=lower(p_target_domain),updated_at=v_now where user_id=p_user_id and id=any(p_memory_ids); end if;
 end if;
 if coalesce(array_length(p_reminder_ids,1),0)>0 then update reminders set bubble_id=v_entity_bubble,updated_at=v_now where user_id=p_user_id and id=any(p_reminder_ids); end if;
 insert into memory_events(memory_id,user_id,action,old_value,new_value,created_at) select m.id,p_user_id,'BRANCH_RELOCATED',m.value,m.value,v_now from memories m where m.user_id=p_user_id and m.bubble_id=v_entity_bubble;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'bubble_id',m.bubble_id,'memory_type',m.memory_type)),'[]') into v_after from memories m where m.user_id=p_user_id and m.bubble_id=v_entity_bubble;
 insert into memory_bubble_moves(user_id,bubble_id,entity_name,source_domain,target_domain,old_relation,new_relation,memory_ids,reminder_ids,before_state,after_state,confirmation_fingerprint,created_at) values(p_user_id,v_entity_bubble,p_entity_name,p_source_domain,p_target_domain,p_old_relation,p_new_relation,to_jsonb(coalesce(p_memory_ids,'{}')),to_jsonb(coalesce(p_reminder_ids,'{}')),v_before,v_after,p_confirmation_fingerprint,v_now);
 return jsonb_build_object('success',true,'bubble_id',v_entity_bubble,'target_parent_bubble_id',v_target_parent,'moved_memory_count',v_mem_count,'moved_reminder_count',v_rem_count,'descendant_bubble_count',v_descendant_count,'target_domain',p_target_domain,'target_relation',p_new_relation);
end; $$;

revoke all on function public.move_memory_branch_atomic_v3(uuid,uuid[],uuid[],text,text,text,text,text,uuid,text,text,jsonb) from public;
grant execute on function public.move_memory_branch_atomic_v3(uuid,uuid[],uuid[],text,text,text,text,text,uuid,text,text,jsonb) to service_role;
