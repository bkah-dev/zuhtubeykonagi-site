create or replace function public.add_confirmed_personel_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  if new.email is null
     or lower(new.email) not like '%@personel.zuhtubeykonagi.com'
     or new.email_confirmed_at is null then
    return new;
  end if;

  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(new.email, '@', 1)
  );

  insert into public.staff_members (user_id, display_name, role)
  values (new.id, v_display_name, 'staff')
  on conflict (user_id) do update
    set display_name = case
      when public.staff_members.display_name = '' then excluded.display_name
      else public.staff_members.display_name
    end;

  return new;
end;
$$;

revoke all on function public.add_confirmed_personel_account() from public;

drop trigger if exists on_confirmed_personel_account on auth.users;
create trigger on_confirmed_personel_account
after insert or update of email, email_confirmed_at on auth.users
for each row
execute function public.add_confirmed_personel_account();

-- Entegrasyon devreye girmeden önce açılmış uygun hesapları da tamamlar.
-- Çakışmada rol güncellenmez; mevcut yönetici hesabı yönetici kalır.
insert into public.staff_members (user_id, display_name, role)
select
  id,
  coalesce(
    nullif(raw_user_meta_data ->> 'display_name', ''),
    split_part(email, '@', 1)
  ),
  'staff'
from auth.users
where email_confirmed_at is not null
  and lower(email) like '%@personel.zuhtubeykonagi.com'
on conflict (user_id) do nothing;
