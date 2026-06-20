-- 바른플랜 병원도 구독 레코드를 갖고 매달 200토큰 차감→즉시 환불(net 0)되게 변경.
-- 공용 과금 헬퍼 bill_subscription 를 subscribe·renewal·백필이 공유.

-- 한 주기 과금: 차감 + (바른플랜이면 즉시 환불). 반환 ok|insufficient
-- 바른플랜은 잔액 검사 없이 net 0 이라 잔액 부족이어도 통과(절대 lapse 안 됨).
create or replace function billing.bill_subscription(
  p_hospital_id uuid, p_product_code text, p_price numeric, p_note text
) returns text
language plpgsql security definer set search_path = billing, core, public
as $$
declare v_balance numeric; v_barun boolean;
begin
  select token_balance,
         (barun_plan_enabled
          and (barun_plan_start is null or current_date >= barun_plan_start)
          and (barun_plan_end   is null or current_date <= barun_plan_end))
    into v_balance, v_barun
    from core.hospitals where id = p_hospital_id::text;

  if not coalesce(v_barun, false) and coalesce(v_balance, 0) < p_price then
    return 'insufficient';
  end if;

  update core.hospitals set token_balance = coalesce(token_balance, 0) - p_price
   where id = p_hospital_id::text returning token_balance into v_balance;
  insert into billing.token_ledger(hospital_id, feature, tokens, balance_after, kind, note, product_code)
    values (p_hospital_id, 'subscription', -p_price, v_balance, 'charge', p_note, p_product_code);

  if coalesce(v_barun, false) then
    update core.hospitals set token_balance = coalesce(token_balance, 0) + p_price
     where id = p_hospital_id::text returning token_balance into v_balance;
    insert into billing.token_ledger(hospital_id, feature, tokens, balance_after, kind, note, product_code)
      values (p_hospital_id, 'subscription', p_price, v_balance, 'adjust', '바른플랜 면제 환불', p_product_code);
  end if;
  return 'ok';
end $$;

-- 구독 시작 — bill_subscription 사용
create or replace function billing.subscribe(p_hospital_id uuid, p_product_code text)
returns text
language plpgsql security definer set search_path = billing, core, public
as $$
declare v_price numeric; v_status text; v_end timestamptz; v_res text;
begin
  select price_tokens into v_price
    from billing.products where code = p_product_code and billing_type = 'subscription' and active;
  if v_price is null then return 'no_product'; end if;

  select status, current_period_end into v_status, v_end
    from billing.subscriptions where hospital_id = p_hospital_id and product_code = p_product_code;
  if v_status is not null and v_status <> 'lapsed' and v_end > now() then return 'exists'; end if;

  v_res := billing.bill_subscription(p_hospital_id, p_product_code, v_price, '구독 시작');
  if v_res <> 'ok' then return v_res; end if;

  insert into billing.subscriptions(hospital_id, product_code, status, price_tokens, current_period_start, current_period_end, auto_renew, canceled_at)
    values (p_hospital_id, p_product_code, 'active', v_price, now(), now() + interval '1 month', true, null)
  on conflict (hospital_id, product_code) do update
    set status = 'active', price_tokens = v_price, current_period_start = now(),
        current_period_end = now() + interval '1 month', auto_renew = true, canceled_at = null, updated_at = now();
  return 'ok';
end $$;

-- 월 갱신 — bill_subscription 사용(바른플랜은 net 0 로 항상 갱신)
create or replace function billing.run_subscription_renewals()
returns table(renewed int, lapsed int)
language plpgsql security definer set search_path = billing, core, public
as $$
declare r record; v_renewed int := 0; v_lapsed int := 0;
begin
  update billing.subscriptions set status = 'lapsed', updated_at = now()
   where status = 'canceled' and current_period_end <= now();

  for r in
    select * from billing.subscriptions
     where status = 'active' and auto_renew and current_period_end <= now()
     for update
  loop
    if billing.bill_subscription(r.hospital_id, r.product_code, r.price_tokens, '구독 갱신') = 'ok' then
      update billing.subscriptions
         set current_period_start = current_period_end,
             current_period_end   = current_period_end + interval '1 month', updated_at = now()
       where id = r.id;
      v_renewed := v_renewed + 1;
    else
      update billing.subscriptions set status = 'lapsed', updated_at = now() where id = r.id;
      v_lapsed := v_lapsed + 1;
    end if;
  end loop;
  return query select v_renewed, v_lapsed;
end $$;

-- 백필: 바른플랜 병원에 ops_bundle 구독 생성 + 이번 달치 차감→환불(net 0)
do $$
declare h record; v_price numeric;
begin
  select price_tokens into v_price from billing.products where code = 'ops_bundle';
  for h in
    select id from core.hospitals
     where barun_plan_enabled
       and (barun_plan_start is null or current_date >= barun_plan_start)
       and (barun_plan_end   is null or current_date <= barun_plan_end)
       and not exists (select 1 from billing.subscriptions s where s.hospital_id = id::uuid and s.product_code = 'ops_bundle')
  loop
    perform billing.bill_subscription(h.id::uuid, 'ops_bundle', v_price, '구독 시작(바른플랜)');
    insert into billing.subscriptions(hospital_id, product_code, status, price_tokens, current_period_start, current_period_end, auto_renew)
      values (h.id::uuid, 'ops_bundle', 'active', v_price, now(), now() + interval '1 month', true);
  end loop;
end $$;
