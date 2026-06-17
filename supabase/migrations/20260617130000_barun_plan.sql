-- 바른반려연구소 플랜 고객: 플랜 활성 기간(start~end) 동안 진료케이스 작성 단계 토큰 차감을 면제.
-- 종료일 이후부터는 정상 차감(20배). 토글 + 시작/종료일을 core.hospitals 에 둔다.
alter table core.hospitals add column if not exists barun_plan_enabled boolean not null default false;
alter table core.hospitals add column if not exists barun_plan_start date;
alter table core.hospitals add column if not exists barun_plan_end   date;

-- token_charge_operation: ① 진료케이스 작성 단계 20배(인건비) ② 바른플랜 활성 기간이면 그 단계 차감 면제(0토큰 기록).
create or replace function billing.token_charge_operation(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_feature         text default null,
  p_token_value_usd numeric default 0.01
) returns table(tokens numeric, balance_after numeric, cost_usd numeric)
language plpgsql security definer as $$
declare
  v_cost    numeric;
  v_tokens  numeric;
  v_balance numeric;
  v_is_case boolean;
  v_waive   boolean;
begin
  if p_hospital_id is null or p_operation_id is null then
    return;
  end if;
  if exists (select 1 from billing.token_ledger l where l.operation_id = p_operation_id and l.kind = 'charge') then
    return; -- 이미 청구됨
  end if;
  select coalesce(sum(u.cost_usd), 0) into v_cost
    from billing.llm_usage u
   where u.operation_id = p_operation_id and u.hospital_id = p_hospital_id::uuid;
  if v_cost <= 0 then
    return; -- 비용 없음
  end if;

  v_is_case := p_feature in ('blog_causal', 'blog_detail', 'blog_outline', 'blog_post');
  v_tokens  := ceil(v_cost / nullif(p_token_value_usd, 0));
  if v_is_case then
    v_tokens := v_tokens * 20; -- 진료케이스 작성 단계 인건비 반영
  end if;

  -- 바른반려연구소 플랜 고객(활성 기간)이면 진료케이스 차감 면제(기록만 0토큰으로 남김).
  if v_is_case then
    select (h.barun_plan_enabled
            and (h.barun_plan_start is null or current_date >= h.barun_plan_start)
            and (h.barun_plan_end   is null or current_date <= h.barun_plan_end))
      into v_waive
      from core.hospitals h
     where h.id = p_hospital_id;
    if coalesce(v_waive, false) then
      select coalesce(token_balance, 0) into v_balance from core.hospitals where id = p_hospital_id;
      insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, note)
        values (p_hospital_id::uuid, p_operation_id, p_feature, v_cost, 0, v_balance, 'charge', 'barun_plan_free');
      return query select 0::numeric, v_balance, v_cost;
      return;
    end if;
  end if;

  if v_tokens <= 0 then
    return;
  end if;

  update core.hospitals
     set token_balance = coalesce(token_balance, 0) - v_tokens
   where id = p_hospital_id
   returning token_balance into v_balance;

  insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind)
    values (p_hospital_id::uuid, p_operation_id, p_feature, v_cost, -v_tokens, v_balance, 'charge');

  return query select v_tokens, v_balance, v_cost;
end $$;

grant execute on function billing.token_charge_operation(text, uuid, text, numeric) to service_role;
