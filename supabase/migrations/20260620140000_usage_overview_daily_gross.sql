-- my_usage_overview: 사용량 그래프(daily)를 net → gross 로 환원.
-- 이전(130000)에 바른플랜 환불을 daily 에서 차감(net)했더니, 환불 병원은 모든 항목이 0 이 되어
-- 그래프가 비어버렸다. 그래프는 "실제 사용량(차감, charge)"을 그대로 보여주고, 환불/무료 여부는
-- 잔액·상세 내역에서 확인하게 한다. (ledger 부분은 그대로)
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

  -- 사용량(일자×기능) — 실제 차감(charge)만, gross. (환불 adjust 는 그래프에서 제외)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('date', d.date, 'feature', d.feature, 'tokens', d.tokens) order by d.date), '[]'::jsonb)
      into v_daily
    from (
      select to_char(date_trunc('day', tl.created_at), 'YYYY-MM-DD') as date,
             coalesce(tl.feature, '(기타)') as feature,
             sum(-tl.tokens)::float8 as tokens
        from billing.token_ledger tl
       where tl.hospital_id = v_hid::uuid
         and tl.kind = 'charge'
         and tl.created_at >= now() - make_interval(days => p_days)
       group by 1, 2
    ) d
    where d.tokens <> 0
  ;
  exception when others then
    v_daily := '[]'::jsonb;
  end;

  -- 사용·충전 내역 (그대로)
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
