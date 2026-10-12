-- UGCBatch Studio: initial schema for a DEDICATED Supabase project
-- (do NOT run against the UGCBatch app's project). Multi-tenant via RLS on user_id.
create extension if not exists "pgcrypto";

create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  locale text not null default 'en' check (locale in ('en','vi')),
  output_language text not null default 'en' check (output_language in ('en','vi')),
  data jsonb not null default '{}'::jsonb,       -- product, scripts, storyboard (mirrors local SQLite rows)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_projects_user_idx on public.studio_projects(user_id, updated_at desc);

create table if not exists public.studio_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.studio_projects(id) on delete cascade,
  provider text not null,                         -- 'mock' until real keys are configured
  model_id text not null,
  media_type text not null check (media_type in ('image','video')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  task_id text,
  prompt text not null default '',
  result_urls text[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_generations_user_idx on public.studio_generations(user_id, created_at desc);

alter table public.studio_projects enable row level security;
alter table public.studio_generations enable row level security;

create policy studio_projects_owner on public.studio_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy studio_generations_owner on public.studio_generations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
