create extension if not exists pgcrypto;

create table if not exists public.restaurant_tables (
  id smallint primary key check (id between 1 and 15),
  note text not null default '',
  opened_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.table_items (
  table_number smallint not null references public.restaurant_tables(id) on delete cascade,
  product_id text not null,
  name text not null,
  category text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  primary key (table_number, product_id)
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  table_number smallint not null,
  opened_at timestamptz,
  closed_at timestamptz not null default now(),
  payment_method text not null check (payment_method in ('Nakit', 'Kart', 'Karma')),
  note text not null default '',
  total numeric(10,2) not null check (total >= 0),
  closed_by uuid not null references auth.users(id)
);

create table if not exists public.sale_items (
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id text not null,
  name text not null,
  category text not null,
  unit_price numeric(10,2) not null,
  quantity integer not null,
  line_total numeric(10,2) not null
);

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- İlk dağıtımdan önce Supabase panelinden oluşturulan kullanıcıları yetkilendirir.
-- Sonradan açılan hesaplar ayrıca staff_members tablosuna eklenmelidir.
insert into public.staff_members (user_id, display_name)
select id, coalesce(raw_user_meta_data ->> 'display_name', '')
from auth.users
on conflict (user_id) do nothing;

insert into public.restaurant_tables (id)
select generate_series(1, 15)
on conflict (id) do nothing;

alter table public.restaurant_tables enable row level security;
alter table public.table_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.staff_members enable row level security;

revoke all on public.restaurant_tables, public.table_items, public.sales, public.sale_items, public.staff_members from anon;
grant select on public.restaurant_tables, public.table_items, public.sales, public.sale_items, public.staff_members to authenticated;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_members where user_id = auth.uid()
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

create policy "staff can read own membership"
on public.staff_members for select to authenticated
using (user_id = auth.uid());

create policy "staff can read tables"
on public.restaurant_tables for select to authenticated using (public.is_staff());

create policy "staff can read active items"
on public.table_items for select to authenticated using (public.is_staff());

create policy "staff can read sales"
on public.sales for select to authenticated using (public.is_staff());

create policy "staff can read sale items"
on public.sale_items for select to authenticated using (public.is_staff());

create or replace function public.change_table_item(
  p_table_number smallint,
  p_product_id text,
  p_name text,
  p_category text,
  p_unit_price numeric,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Personel yetkisi gerekli'; end if;
  if p_table_number not between 1 and 15 then raise exception 'Geçersiz masa'; end if;
  if p_delta = 0 or abs(p_delta) > 100 then raise exception 'Geçersiz adet'; end if;

  perform 1 from public.restaurant_tables where id = p_table_number for update;

  if p_delta > 0 then
    insert into public.table_items (table_number, product_id, name, category, unit_price, quantity)
    values (p_table_number, p_product_id, p_name, p_category, p_unit_price, p_delta)
    on conflict (table_number, product_id) do update
      set quantity = public.table_items.quantity + excluded.quantity,
          name = excluded.name,
          category = excluded.category,
          unit_price = excluded.unit_price,
          updated_at = now();
  else
    update public.table_items
      set quantity = quantity + p_delta, updated_at = now()
      where table_number = p_table_number and product_id = p_product_id;
    delete from public.table_items
      where table_number = p_table_number and product_id = p_product_id and quantity <= 0;
  end if;

  update public.restaurant_tables
    set opened_at = case
          when exists (select 1 from public.table_items where table_number = p_table_number)
            then coalesce(opened_at, now())
          else null
        end,
        note = case
          when exists (select 1 from public.table_items where table_number = p_table_number)
            then note
          else ''
        end,
        updated_at = now()
    where id = p_table_number;
end;
$$;

create or replace function public.set_table_note(p_table_number smallint, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Personel yetkisi gerekli'; end if;
  if p_table_number not between 1 and 15 then raise exception 'Geçersiz masa'; end if;
  update public.restaurant_tables
    set note = left(coalesce(p_note, ''), 500), updated_at = now()
    where id = p_table_number;
end;
$$;

create or replace function public.close_table(
  p_table_number smallint,
  p_payment_method text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_total numeric(10,2);
  v_opened_at timestamptz;
  v_closed_at timestamptz := now();
  v_items jsonb;
begin
  if not public.is_staff() then raise exception 'Personel yetkisi gerekli'; end if;
  if p_table_number not between 1 and 15 then raise exception 'Geçersiz masa'; end if;
  if p_payment_method not in ('Nakit', 'Kart', 'Karma') then raise exception 'Geçersiz ödeme türü'; end if;

  select opened_at into v_opened_at
  from public.restaurant_tables where id = p_table_number for update;

  select coalesce(sum(unit_price * quantity), 0),
         jsonb_agg(jsonb_build_object(
           'id', product_id,
           'name', name,
           'category', category,
           'price', unit_price,
           'quantity', quantity,
           'lineTotal', unit_price * quantity
         ) order by name)
    into v_total, v_items
  from public.table_items
  where table_number = p_table_number;

  if v_total <= 0 or v_items is null then raise exception 'Masada ürün yok'; end if;

  insert into public.sales (table_number, opened_at, closed_at, payment_method, note, total, closed_by)
  values (p_table_number, v_opened_at, v_closed_at, p_payment_method, left(coalesce(p_note, ''), 500), v_total, auth.uid())
  returning id into v_sale_id;

  insert into public.sale_items (sale_id, product_id, name, category, unit_price, quantity, line_total)
  select v_sale_id, product_id, name, category, unit_price, quantity, unit_price * quantity
  from public.table_items where table_number = p_table_number;

  delete from public.table_items where table_number = p_table_number;
  update public.restaurant_tables set note = '', opened_at = null, updated_at = now() where id = p_table_number;

  return jsonb_build_object(
    'saleId', v_sale_id,
    'tableNumber', p_table_number,
    'openedAt', v_opened_at,
    'closedAt', v_closed_at,
    'paymentMethod', p_payment_method,
    'note', left(coalesce(p_note, ''), 500),
    'total', v_total,
    'items', v_items
  );
end;
$$;

revoke all on function public.change_table_item(smallint, text, text, text, numeric, integer) from public;
revoke all on function public.set_table_note(smallint, text) from public;
revoke all on function public.close_table(smallint, text, text) from public;
grant execute on function public.change_table_item(smallint, text, text, text, numeric, integer) to authenticated;
grant execute on function public.set_table_note(smallint, text) to authenticated;
grant execute on function public.close_table(smallint, text, text) to authenticated;

alter table public.restaurant_tables replica identity full;
alter table public.table_items replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.restaurant_tables;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.table_items;
exception when duplicate_object then null;
end $$;
