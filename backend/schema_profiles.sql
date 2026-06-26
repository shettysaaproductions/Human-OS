-- Create profiles table
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  preferred_name text,
  companion_personality text,
  onboarding_completed boolean default false,
  onboarding_completed_at timestamptz,
  onboarding_version integer default 1,
  timezone text,
  last_active_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS (optional, but good practice. For now, backend uses service_role so it bypasses RLS anyway)
alter table public.profiles enable row level security;

-- Create policy for users to view/edit their own profile (if client accesses it directly)
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);
