-- my_usage_overview: 사용·충전 내역(ledger)을 작업(run) 단위로 묶을 수 있도록 각 charge 행에 run_id 를 실어준다.
-- token_ledger 에는 run_id 가 없고 billing.llm_usage 에만 있으므로 operation_id 로 조인해 가져온다.
-- (grant/adjust 는 operation_id 가 없어 run_id=null → 화면에서 개별 행으로 표시)
-- limit 50 → 200 으로 상향: 그룹핑하면 줄 수가 줄어드니 최근 작업을 충분히 담는다.
create or replace function core.my_usage_overview(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = core, billing, chart_pdf, public
as $func$
declare
  v_hid     text;
  v_balance numeric;
  v_daily   jsonb := '[]'::jsonb;
  v_ledger  jsonb := '[]'::jsonb;
begin
  select hospital_id into v_hid from core.users where id::text = (auth.uid())::text;
  if v_hid is null then
    return jsonb_build_object('balance', null, 'daily', '[]'::jsonb, 'ledger', '[]'::jsonb);
  end if;

  select token_balance into v_balance from core.hospitals where id = v_hid;

  -- 사용량(일자×기능)
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

  -- 사용·충전 내역 (+ run_id: operation_id → llm_usage.run_id, + 보호자/환자명: run → result_basic_info)
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
              'createdAt', l.created_at, 'kind', l.kind, 'feature', l.feature,
              'tokens', l.tokens, 'balanceAfter', l.balance_after, 'runId', l.run_id,
              'ownerName', l.owner_name, 'patientName', l.patient_name) order by l.created_at desc), '[]'::jsonb)
      into v_ledger
    from (
      select base.created_at, base.kind, base.feature, base.tokens, base.balance_after, base.run_id,
             bi.owner_name, bi.patient_name
      from (
        select tl.created_at, tl.kind, tl.feature, tl.tokens, tl.balance_after,
               (select u.run_id from billing.llm_usage u
                 where u.operation_id = tl.operation_id and u.run_id is not null
                 limit 1) as run_id
          from billing.token_ledger tl
         where tl.hospital_id = v_hid::uuid
         order by tl.created_at desc
         limit 200
      ) base
      left join chart_pdf.result_basic_info bi on bi.parse_run_id = base.run_id
    ) l;
  exception when others then
    v_ledger := '[]'::jsonb;
  end;

  return jsonb_build_object('balance', v_balance, 'daily', coalesce(v_daily, '[]'::jsonb), 'ledger', coalesce(v_ledger, '[]'::jsonb));
end $func$;

grant execute on function core.my_usage_overview(int) to authenticated;
