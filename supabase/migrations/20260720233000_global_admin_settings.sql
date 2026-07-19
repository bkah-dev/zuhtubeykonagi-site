alter table public.staff_members
  add column if not exists role text not null default 'staff'
  check (role in ('admin', 'staff'));

with first_member as (
  select user_id from public.staff_members order by created_at, user_id limit 1
)
update public.staff_members
set role = 'admin'
where user_id in (select user_id from first_member);

create table if not exists public.app_settings (
  setting_key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.app_settings (setting_key, value)
values ('sheets_endpoint', '')
on conflict (setting_key) do nothing;

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
grant select on public.app_settings to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_members
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create policy "staff can read global settings"
on public.app_settings for select to authenticated
using (public.is_staff());

create or replace function public.set_sheet_endpoint(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint text := trim(coalesce(p_endpoint, ''));
begin
  if not public.is_admin() then raise exception 'Yönetici yetkisi gerekli'; end if;
  if v_endpoint <> '' and (
    left(v_endpoint, 26) <> 'https://script.google.com/' or
    right(v_endpoint, 5) <> '/exec'
  ) then
    raise exception 'Geçerli bir Apps Script /exec adresi gerekli';
  end if;

  insert into public.app_settings (setting_key, value, updated_at, updated_by)
  values ('sheets_endpoint', v_endpoint, now(), auth.uid())
  on conflict (setting_key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.set_sheet_endpoint(text) from public;
grant execute on function public.set_sheet_endpoint(text) to authenticated;
