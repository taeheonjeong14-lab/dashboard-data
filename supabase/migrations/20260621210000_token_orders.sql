-- 토큰 구매 주문(무통장입금) — 구매하기=주문 생성(pending), admin 입금확인=충전.

-- 충전 상품(주문 금액·토큰의 권위 소스). 프런트 표시값과 일치 시드.
create table if not exists billing.token_packages (
  id           text primary key,
  base_tokens  int not null,
  bonus_tokens int not null default 0,
  bonus_pct    int not null default 0,
  price_krw    int not null,
  tag          text,
  active       boolean not null default true,
  sort_order   int not null default 0
);
insert into billing.token_packages (id, base_tokens, bonus_tokens, bonus_pct, price_krw, tag, sort_order) values
  ('p1', 1200, 0,   0, 100000, null,        10),
  ('p2', 2400, 72,  3, 200000, null,        20),
  ('p3', 4800, 240, 5, 400000, '최대 적립', 30)
on conflict (id) do nothing;

-- 주문번호용 시퀀스(연도-0001 형식)
create sequence if not exists billing.token_order_seq;

create table if not exists billing.token_orders (
  id           uuid primary key default gen_random_uuid(),
  order_no     text unique not null,
  hospital_id  uuid not null,
  package_id   text not null,
  base_tokens  int not null,
  bonus_tokens int not null,
  total_tokens int not null,
  price_krw    int not null,
  status       text not null default 'pending' check (status in ('pending', 'paid', 'canceled')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  paid_by      uuid
);
create index if not exists idx_token_orders_status on billing.token_orders (status, created_at desc);
create index if not exists idx_token_orders_hospital on billing.token_orders (hospital_id, created_at desc);

grant select, insert, update, delete on billing.token_packages to service_role;
grant select, insert, update, delete on billing.token_orders to service_role;
grant select on billing.token_packages to authenticated;

-- 주문 생성(pending). 금액·토큰은 상품 테이블에서 가져옴(클라이언트 위변조 방지).
create or replace function billing.create_token_order(p_hospital_id uuid, p_package_id text, p_created_by uuid)
returns jsonb
language plpgsql security definer set search_path = billing, public
as $$
declare pk record; v_no text; v_row billing.token_orders;
begin
  select * into pk from billing.token_packages where id = p_package_id and active;
  if not found then return jsonb_build_object('error', 'invalid_package'); end if;
  v_no := to_char(now() at time zone 'Asia/Seoul', 'YYYY') || '-' || lpad(nextval('billing.token_order_seq')::text, 4, '0');
  insert into billing.token_orders(order_no, hospital_id, package_id, base_tokens, bonus_tokens, total_tokens, price_krw, created_by)
    values (v_no, p_hospital_id, pk.id, pk.base_tokens, pk.bonus_tokens, pk.base_tokens + pk.bonus_tokens, pk.price_krw, p_created_by)
    returning * into v_row;
  return jsonb_build_object('orderNo', v_row.order_no, 'totalTokens', v_row.total_tokens,
    'baseTokens', v_row.base_tokens, 'bonusTokens', v_row.bonus_tokens, 'priceKrw', v_row.price_krw, 'status', v_row.status);
end $$;

-- admin 입금 확인 → 충전(token_grant) + paid. (pending 일 때만, 중복지급 방지)
create or replace function billing.confirm_token_order(p_order_id uuid, p_admin uuid)
returns text
language plpgsql security definer set search_path = billing, core, public
as $$
declare o billing.token_orders;
begin
  select * into o from billing.token_orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status <> 'pending' then return 'not_pending'; end if;
  perform billing.token_grant(o.hospital_id::text, o.total_tokens, '토큰 구매 ' || o.order_no, 'grant');
  update billing.token_orders set status = 'paid', paid_at = now(), paid_by = p_admin where id = o.id;
  return 'ok';
end $$;

-- ── core wrapper(앱: auth.uid 기반, 마스터만) ──────────────────────────────
create or replace function core.create_token_order(p_package_id text)
returns jsonb language plpgsql security definer set search_path = core, billing, public as $$
declare v_hid text; v_role text;
begin
  select hospital_id, hospital_role into v_hid, v_role from core.users where id::text = (auth.uid())::text;
  if v_hid is null then return jsonb_build_object('error', 'no_hospital'); end if;
  if v_role is distinct from 'master' then return jsonb_build_object('error', 'not_master'); end if;
  return billing.create_token_order(v_hid::uuid, p_package_id, (auth.uid())::uuid);
end $$;
grant execute on function core.create_token_order(text) to authenticated;

create or replace function core.my_token_orders()
returns jsonb language plpgsql security definer set search_path = core, billing, public as $$
declare v_hid text; v_items jsonb;
begin
  select hospital_id into v_hid from core.users where id::text = (auth.uid())::text;
  if v_hid is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'orderNo', order_no, 'baseTokens', base_tokens, 'bonusTokens', bonus_tokens, 'totalTokens', total_tokens,
           'priceKrw', price_krw, 'status', status, 'createdAt', created_at, 'paidAt', paid_at
         ) order by created_at desc), '[]'::jsonb)
    into v_items
    from billing.token_orders where hospital_id = v_hid::uuid;
  return v_items;
end $$;
grant execute on function core.my_token_orders() to authenticated;
