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
    delete from public.table_items
      where table_number = p_table_number
        and product_id = p_product_id
        and quantity <= abs(p_delta);

    update public.table_items
      set quantity = quantity + p_delta, updated_at = now()
      where table_number = p_table_number
        and product_id = p_product_id
        and quantity > abs(p_delta);
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

create or replace function public.remove_table_item(
  p_table_number smallint,
  p_product_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Personel yetkisi gerekli'; end if;
  if p_table_number not between 1 and 15 then raise exception 'Geçersiz masa'; end if;

  perform 1 from public.restaurant_tables where id = p_table_number for update;
  delete from public.table_items
    where table_number = p_table_number and product_id = p_product_id;

  update public.restaurant_tables
    set opened_at = case
          when exists (select 1 from public.table_items where table_number = p_table_number)
            then opened_at
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

revoke all on function public.remove_table_item(smallint, text) from public;
grant execute on function public.remove_table_item(smallint, text) to authenticated;
