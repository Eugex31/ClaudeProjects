create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'editor', 'viewer');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  plan text not null default 'pilot' check (plan in ('pilot', 'pro')),
  monthly_generation_quota int not null default 20 check (monthly_generation_quota >= 0),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.member_role not null default 'editor' check (role <> 'owner'),
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  language text not null default 'en' check (language in ('en', 'pt', 'es', 'fr')),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references auth.users,
  approved_at timestamptz,
  share_token text unique check (share_token is null or char_length(share_token) = 32),
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index projects_org_idx on public.projects (org_id);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null,
  kind text not null check (kind in ('model', 'manual', 'export')),
  storage_path text not null,
  filename text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index assets_project_idx on public.assets (project_id);

create table public.storyboards (
  project_id uuid primary key,
  org_id uuid not null,
  parts jsonb not null default '[]',
  steps jsonb not null default '[]',
  manual_text text not null default '' check (char_length(manual_text) <= 500000),
  updated_at timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);

create table public.usage (
  org_id uuid not null references public.organizations on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  generations int not null default 0,
  primary key (org_id, period)
);

create table public.sample_templates (
  id text primary key,
  project_name text not null,
  manual_text text not null,
  parts jsonb not null,
  steps jsonb not null,
  model_path text not null
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('org-files', 'org-files', false, 209715200)
on conflict (id) do nothing;
