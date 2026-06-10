-- my_usage_overview 방탄화: billing.llm_usage / billing.token_ledger 가 아직 없거나(마이그레이션 전)
-- 조회 중 오류가 나도, 잔액(core.hospitals.token_balance)은 항상 반환되도록 한다.
-- 기존 버전은 billing 조회 한 곳이라도 실패하면 함수 전체가 에러 → 클라이언트가 catch 하며 balance=null('-')로 표시되던 문제 수정.
create or replace function core.my_usage_overview(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = core, billing, public
as $$
declare
  v_hid     text;
  v_balance numeric;
  v_daily   jsonb := '[]'::jsonb;
  v_ledger  jsonb := '[]'::jsonb;
begin
  -- users.id / auth.uid() 타입(text/uuid) 불일치 방지로 text 비교.
  select hospital_id into v_hid from core.users where id::text = (auth.uid())::text;
  if v_hid is null then
    return jsonb_build_object('balance', null, 'daily', '[]'::jsonb, 'ledger', '[]'::jsonb);
  end if;

  -- 잔액은 billing 과 독립적으로 먼저 확보(여기서 실패하면 그대로 에러가 맞다).
  select token_balance into v_balance from core.hospitals where id = v_hid;

  -- 사용량(일자×기능). billing.llm_usage 부재/오류여도 잔액 표시를 막지 않도록 격리.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('date', d.date, 'feature', d.feature, 'costUsd', d.cost) order by d.date), '[]'::jsonb)
      into v_daily
    from (
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as date,
             coalesce(feature, '(기타)') as feature,
             sum(cost_usd)::float8 as cost
        from billing.llm_usage
       where hospital_id = v_hid::uuid and created_at >= now() - make_interval(days => p_days)
       group by 1, 2
    ) d;
  exception when others then
    v_daily := '[]'::jsonb;
  end;

  -- 사용·충전 내역. billing.token_ledger 부재/오류여도 잔액 표시를 막지 않도록 격리.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
              'createdAt', l.created_at, 'kind', l.kind, 'feature', l.feature,
              'tokens', l.tokens, 'balanceAfter', l.balance_after) order by l.created_at desc), '[]'::jsonb)
      into v_ledger
    from (
      select created_at, kind, feature, tokens, balance_after
        from billing.token_ledger
       where hospital_id = v_hid::uuid
       order by created_at desc
       limit 50
    ) l;
  exception when others then
    v_ledger := '[]'::jsonb;
  end;

  return jsonb_build_object('balance', v_balance, 'daily', coalesce(v_daily, '[]'::jsonb), 'ledger', coalesce(v_ledger, '[]'::jsonb));
end $$;

grant execute on function core.my_usage_overview(int) to authenticated;
