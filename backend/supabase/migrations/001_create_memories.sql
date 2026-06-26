-- 1. Create memories table
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  memory_type text not null,
  key text not null,
  value text not null,
  importance integer default 5,
  confidence numeric default 0.8,
  is_user_confirmed boolean default false,
  source_message text,
  last_accessed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Create indexes
create index idx_memories_user_id on memories(user_id);
create index idx_memories_type on memories(memory_type);
create index idx_memories_key on memories(key);

-- 3. Create memory_events table
create table memory_events (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid,
  user_id uuid not null,
  action text not null,
  old_value text,
  new_value text,
  created_at timestamptz default now()
);
