create table if not exists public.user_settings (
  tg_id text primary key,
  current_space_id text,
  updated_at timestamptz not null default now()
);

create or replace function public.set_user_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_settings_updated_at on public.user_settings;

create trigger set_user_settings_updated_at
before update on public.user_settings
for each row
execute function public.set_user_settings_updated_at();
