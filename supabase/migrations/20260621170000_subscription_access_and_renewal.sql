-- 구독 접근권 판정 + 월 갱신(자동결제) 함수.
-- 접근권: 바른플랜 활성(면제) OR 해당 기능 포함 상품 구독 활성. → 게이팅·사용환불 공용.

create or replace function billing.hospital_has_feature(p_hospital_id uuid, p_feature_key text)
returns boolean
language sql stable security definer
set search_path = billing, core, public
as $$
  select
    exists ( -- 바른플랜 활성이면 전 기능 면제(접근 허용)
      select 1 from core.hospitals h
       where h.id = p_hospital_id::text and h.barun_plan_enabled
         and (h.barun_plan_start is null or current_date >= h.barun_plan_start)
         and (h.barun_plan_end   is null or current_date <= h.barun_plan_end)
    )
    or exists ( -- 해당 기능 포함 상품에 활성 구독(기간 내, lapsed 아님; canceled 는 기간 끝까지 유효)
      select 1
        from billing.subscriptions s
        join billing.product_features pf on pf.product_code = s.product_code
       where s.hospital_id = p_hospital_id
         and pf.feature_key = p_feature_key
         and s.status <> 'lapsed'
         and s.current_period_end > now()
    );
$$;
grant execute on function billing.hospital_has_feature(uuid, text) to authenticated, service_role;

-- 월 갱신: period_end 지난 active 구독에 정액 차감+연장. 잔액부족→lapsed. canceled 만료→lapsed(종료).
-- (바른플랜 병원은 구독 레코드가 없으므로 여기서 과금 안 됨 = 자동 면제)
create or replace function billing.run_subscription_renewals()
returns table(renewed int, lapsed int)
language plpgsql security definer
set search_path = billing, core, public
as $$
declare
  r record;
  v_balance numeric;
  v_renewed int := 0;
  v_lapsed  int := 0;
begin
  -- 취소 후 기간 만료 → 종료(lapsed)
  update billing.subscriptions
     set status = 'lapsed', updated_at = now()
   where status = 'canceled' and current_period_end <= now();

  for r in
    select * from billing.subscriptions
     where status = 'active' and auto_renew and current_period_end <= now()
     for update
  loop
    select token_balance into v_balance from core.hospitals where id = r.hospital_id::text;
    if coalesce(v_balance, 0) >= r.price_tokens then
      update core.hospitals
         set token_balance = coalesce(token_balance, 0) - r.price_tokens
       where id = r.hospital_id::text
       returning token_balance into v_balance;
      insert into billing.token_ledger(hospital_id, feature, tokens, balance_after, kind, note, product_code)
        values (r.hospital_id, 'subscription', -r.price_tokens, v_balance, 'charge', '구독 갱신', r.product_code);
      update billing.subscriptions
         set current_period_start = current_period_end,
             current_period_end   = current_period_end + interval '1 month',
             updated_at = now()
       where id = r.id;
      v_renewed := v_renewed + 1;
    else
      update billing.subscriptions set status = 'lapsed', updated_at = now() where id = r.id;
      v_lapsed := v_lapsed + 1;
    end if;
  end loop;

  return query select v_renewed, v_lapsed;
end $$;
grant execute on function billing.run_subscription_renewals() to service_role;
