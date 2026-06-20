-- my_usage_overview: 사용량 그래프(daily)를 "상품 단위"로 집계한다.
-- API 피처(extract/ocr/kakao_alimtalk/blog_*/health_checkup…)가 아니라, 그 차감이 속한 run 의
-- 상품(진료케이스 / 건강검진 리포트)으로 귀속한다.
--  · 추출(extract/ocr)·알림톡(kakao_alimtalk)도 그 run 의 상품에 합산 (별도 버킷 X)
--  · run 이 없는 알림톡 = 사전문진
--  · run 이 없는(상품 미연결) 옛 추출 등은 '기타'
-- (ledger 부분은 그대로)
create or replace function core.my_usage_overview(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = core, billing, chart_pdf, health_report, public
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

  -- 사용량(일자×상품) — 실제 차감(charge)만, gross.
  begin
    with ch as (
      select tl.created_at,
             (-tl.tokens)::float8 as tok,
             tl.feature,
             (select u.run_id from billing.llm_usage u
               where u.operation_id = tl.operation_id and u.run_id is not null limit 1) as run_id
        from billing.token_ledger tl
       where tl.hospital_id = v_hid::uuid
         and tl.kind = 'charge'
         and tl.created_at >= now() - make_interval(days => p_days)
    ),
    rp as ( -- run 별 상품(글쓰기/건강검진 피처 + extract_jobs.kind 로 판정)
      select c.run_id,
        case
          when bool_or(ej.kind = 'blog_case') or bool_or(c.feature like 'blog%') then '진료케이스'
          when bool_or(ej.kind = 'hospital_notes')
            or bool_or(c.feature in ('health_checkup','disease_intro'))
            or bool_or(c.feature like 'image%') then '건강검진 리포트'
          else null
        end as product
        from ch c
        left join health_report.extract_jobs ej on ej.run_id = c.run_id
       where c.run_id is not null
       group by c.run_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('date', d.date, 'feature', d.product, 'tokens', d.tokens) order by d.date), '[]'::jsonb)
      into v_daily
    from (
      select to_char(date_trunc('day', ch.created_at), 'YYYY-MM-DD') as date,
             coalesce(
               rp.product,
               case
                 when ch.feature like 'blog%' then '진료케이스'
                 when ch.feature in ('health_checkup','disease_intro') or ch.feature like 'image%' then '건강검진 리포트'
                 when ch.feature like '%alimtalk%' then '사전문진'   -- run 없는 알림톡 = 사전문진
                 else '기타'
               end
             ) as product,
             sum(ch.tok)::float8 as tokens
        from ch
        left join rp on rp.run_id = ch.run_id
       group by 1, 2
      having sum(ch.tok) <> 0
    ) d;
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
