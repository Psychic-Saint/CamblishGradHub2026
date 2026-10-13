-- Camblish Online Exam: schema (all objects prefixed exm_)
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.exm_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null check (email = lower(email)),
  full_name text,
  id_number text,
  phone text,
  role text not null default 'learner' check (role in ('admin','invigilator','marker','learner')),
  pass_hash text,
  active boolean not null default true,
  failed_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.exm_sessions (
  token text primary key,
  user_id uuid not null references public.exm_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  user_agent text,
  revoked boolean not null default false
);
create index if not exists exm_sessions_user_idx on public.exm_sessions(user_id);

create table if not exists public.exm_exams (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  title text not null,
  qualification text,
  saqa_id text,
  duration_min int not null default 180,
  grace_min int not null default 15,
  pass_mark numeric not null default 60,
  total_marks numeric,
  status text not null default 'draft' check (status in ('draft','open','closed','archived')),
  opens_at timestamptz,
  closes_at timestamptz,
  instructions jsonb not null default '[]'::jsonb,
  paper jsonb not null default '{}'::jsonb,
  memo jsonb not null default '{}'::jsonb,
  datasets jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.exm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exm_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exm_exams(id),
  user_id uuid not null references public.exm_users(id),
  status text not null default 'in_progress' check (status in ('in_progress','submitted','auto_submitted','terminated')),
  started_at timestamptz,
  deadline_at timestamptz,
  hard_deadline_at timestamptz,
  submitted_at timestamptz,
  extra_min int not null default 0,
  answers jsonb not null default '{}'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  total numeric,
  percent numeric,
  result text,
  feedback text,
  marked_by uuid references public.exm_users(id),
  marked_at timestamptz,
  finalised boolean not null default false,
  released_at timestamptz,
  emailed_at timestamptz,
  device jsonb,
  phone_code text unique,
  phone_paired_at timestamptz,
  phone_last_seen timestamptz,
  flags_count int not null default 0,
  last_seen_at timestamptz,
  unique (exam_id, user_id)
);
create index if not exists exm_attempts_user_idx on public.exm_attempts(user_id);
create index if not exists exm_attempts_marked_by_idx on public.exm_attempts(marked_by);
create index if not exists exm_exams_created_by_idx on public.exm_exams(created_by);

create table if not exists public.exm_events (
  id bigserial primary key,
  attempt_id uuid references public.exm_attempts(id),
  exam_id uuid references public.exm_exams(id),
  at timestamptz not null default now(),
  source text not null default 'system' check (source in ('laptop','phone','invigilator','system')),
  kind text not null,
  severity text not null default 'info' check (severity in ('info','warn','high')),
  detail jsonb,
  evidence_path text
);
create index if not exists exm_events_exam_at_idx on public.exm_events(exam_id, at desc);
create index if not exists exm_events_attempt_at_idx on public.exm_events(attempt_id, at desc);

create table if not exists public.exm_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.exm_users enable row level security;
alter table public.exm_sessions enable row level security;
alter table public.exm_exams enable row level security;
alter table public.exm_attempts enable row level security;
alter table public.exm_events enable row level security;
alter table public.exm_settings enable row level security;

revoke all on public.exm_users, public.exm_sessions, public.exm_exams, public.exm_attempts, public.exm_events, public.exm_settings from anon, authenticated;
revoke all on sequence public.exm_events_id_seq from anon, authenticated;

-- Private storage bucket for evidence, papers and datasets (60 MB limit)
insert into storage.buckets (id, name, public, file_size_limit)
values ('exam-files', 'exam-files', false, 62914560)
on conflict (id) do nothing;
