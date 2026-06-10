-- hospital-ui 설정의 "사용량 / 토큰 관리" 용. 로그인 사용자 소속 병원의 사용량·잔액·내역을 jsonb 로 반환.
-- SECURITY DEFINER + auth.uid() 기준이라 자기 병원 것만 본다(타 병원 조회 불가). billing 스키마 미노출이어도 동작.
create or replace function core.my_usage_overview(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = core, billing, public
as $$
declare
  v_hid     text;
  v_balance numeric;
  v_daily   jsonb;
  v_ledger  jsonb;
begin
  -- users.id / auth.uid() 타입(text/uuid) 불일치 방지로 text 비교.
  select hospital_id into v_hid from core.users where id::text = (auth.uid())::text;
  if v_hid is null then
    return jsonb_build_object('balance', null, 'daily', '[]'::jsonb, 'ledger', '[]'::jsonb);
  end if;

  select token_balance into v_balance from core.hospitals where id = v_hid;

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

  return jsonb_build_object('balance', v_balance, 'daily', coalesce(v_daily, '[]'::jsonb), 'ledger', coalesce(v_ledger, '[]'::jsonb));
end $$;

grant execute on function core.my_usage_overview(int) to authenticated;
