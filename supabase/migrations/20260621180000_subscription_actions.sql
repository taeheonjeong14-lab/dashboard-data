-- 구독 시작/취소 + 내 구독 상태. billing(내부) + core(앱 노출 wrapper, auth.uid 기반).

-- 구독 시작: 첫 결제(정액 차감) + 구독 레코드 생성/갱신. 반환: ok|exists|insufficient|no_product
create or replace function billing.subscribe(p_hospital_id uuid, p_product_code text)
returns text
language plpgsql security definer
set search_path = billing, core, public
as $$
declare
  v_price   numeric;
  v_balance numeric;
  v_status  text;
  v_end     timestamptz;
begin
  select price_tokens into v_price
    from billing.products where code = p_product_code and billing_type = 'subscription' and active;
  if v_price is null then return 'no_product'; end if;

  select status, current_period_end into v_status, v_end
    from billing.subscriptions where hospital_id = p_hospital_id and product_code = p_product_code;
  if v_status is not null and v_status <> 'lapsed' and v_end > now() then
    return 'exists';
  end if;

  select token_balance into v_balance from core.hospitals where id = p_hospital_id::text;
  if coalesce(v_balance, 0) < v_price then return 'insufficient'; end if;

  update core.hospitals set token_balance = coalesce(token_balance, 0) - v_price
   where id = p_hospital_id::text returning token_balance into v_balance;
  insert into billing.token_ledger(hospital_id, feature, tokens, balance_after, kind, note, product_code)
    values (p_hospital_id, 'subscription', -v_price, v_balance, 'charge', '구독 시작', p_product_code);

  insert into billing.subscriptions(hospital_id, product_code, status, price_tokens, current_period_start, current_period_end, auto_renew, canceled_at)
    values (p_hospital_id, p_product_code, 'active', v_price, now(), now() + interval '1 month', true, null)
  on conflict (hospital_id, product_code) do update
    set status = 'active', price_tokens = v_price, current_period_start = now(),
        current_period_end = now() + interval '1 month', auto_renew = true, canceled_at = null, updated_at = now();
  return 'ok';
end $$;

-- 취소: auto_renew off + canceled(기간 끝까지 사용). 반환: ok|not_active
create or replace function billing.cancel_subscription(p_hospital_id uuid, p_product_code text)
returns text
language plpgsql security definer
set search_path = billing, core, public
as $$
begin
  update billing.subscriptions
     set status = 'canceled', auto_renew = false, canceled_at = now(), updated_at = now()
   where hospital_id = p_hospital_id and product_code = p_product_code and status = 'active';
  if found then return 'ok'; else return 'not_active'; end if;
end $$;

-- ── core wrapper (앱에서 auth.uid 기반 호출; 마스터만) ──────────────────────
create or replace function core.subscribe_to_product(p_product_code text)
returns text language plpgsql security definer set search_path = core, billing, public as $$
declare v_hid text; v_role text;
begin
  select hospital_id, hospital_role into v_hid, v_role from core.users where id::text = (auth.uid())::text;
  if v_hid is null then return 'no_hospital'; end if;
  if v_role is distinct from 'master' then return 'not_master'; end if;
  return billing.subscribe(v_hid::uuid, p_product_code);
end $$;
grant execute on function core.subscribe_to_product(text) to authenticated;

create or replace function core.cancel_my_subscription(p_product_code text)
returns text language plpgsql security definer set search_path = core, billing, public as $$
declare v_hid text; v_role text;
begin
  select hospital_id, hospital_role into v_hid, v_role from core.users where id::text = (auth.uid())::text;
  if v_hid is null then return 'no_hospital'; end if;
  if v_role is distinct from 'master' then return 'not_master'; end if;
  return billing.cancel_subscription(v_hid::uuid, p_product_code);
end $$;
grant execute on function core.cancel_my_subscription(text) to authenticated;

-- 내 구독/메뉴 상태: 바른플랜 여부 + 구독 상품 목록(상태·기간·접근권)
create or replace function core.my_subscription_status()
returns jsonb language plpgsql security definer set search_path = core, billing, chart_pdf, public as $$
declare v_hid text; v_barun boolean; v_balance numeric; v_items jsonb;
begin
  select hospital_id into v_hid from core.users where id::text = (auth.uid())::text;
  if v_hid is null then return jsonb_build_object('barun', false, 'balance', null, 'products', '[]'::jsonb); end if;

  select (h.barun_plan_enabled
          and (h.barun_plan_start is null or current_date >= h.barun_plan_start)
          and (h.barun_plan_end   is null or current_date <= h.barun_plan_end)),
         h.token_balance
    into v_barun, v_balance
    from core.hospitals h where h.id = v_hid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', p.code, 'name', p.name, 'price_tokens', p.price_tokens,
           'status', s.status, 'currentPeriodEnd', s.current_period_end, 'autoRenew', s.auto_renew
         ) order by p.sort_order), '[]'::jsonb)
    into v_items
    from billing.products p
    left join billing.subscriptions s on s.product_code = p.code and s.hospital_id = v_hid::uuid
   where p.billing_type = 'subscription' and p.active;

  return jsonb_build_object('barun', coalesce(v_barun, false), 'balance', v_balance, 'products', v_items);
end $$;
grant execute on function core.my_subscription_status() to authenticated;
