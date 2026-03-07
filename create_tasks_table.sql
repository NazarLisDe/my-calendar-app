create table if not exists public.tasks (
  id bigint generated always as identity primary key,
  text text not null,
  is_completed boolean not null default false,
  created_at timestamptz not null default now()
);
