-- my_usage_overview: 병원 사용량 '내역(ledger)' 출력에 product_code 를 포함한다.
-- (daily 는 이미 product 기준. ledger 는 feature 만 내려줘 클라이언트가 feature 로 상품을 역추측하고 있었다.)
-- 이제 ledger 각 행이 product_code 를 함께 내려주면, hospital UI 도 admin 과 동일하게 product 기준으로 라벨링하고
-- feature 추측은 legacy(product_code null) 폴백으로만 쓴다. daily 로직·환불 등 나머지는 배포본과 동일.
create or replace function core.my_usage_overview(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'core', 'billing', 'chart_pdf', 'health_report', 'public'
as $function$
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

  begin
    with ch as (
      select tl.created_at, (-tl.tokens)::float8 as tok, tl.feature, tl.product_code,
             (select u.run_id from billing.llm_usage u
               where u.operation_id = tl.operation_id and u.run_id is not null limit 1) as run_id
        from billing.token_ledger tl
       where tl.hospital_id = v_hid::uuid
         and tl.kind = 'charge'
         and tl.created_at >= now() - make_interval(days => p_days)
    ),
    rp as ( -- 레거시 폴백용: run 의 상품
      select c.run_id,
        case
          when bool_or(ej.kind = 'blog_case') or bool_or(c.feature like 'blog%') then 'case_blog'
          when bool_or(ej.kind = 'hospital_notes')
            or bool_or(c.feature in ('health_checkup','disease_intro'))
            or bool_or(c.feature like 'image%') then 'health_report'
          else null
        end as product
        from ch c left join health_report.extract_jobs ej on ej.run_id = c.run_id
       where c.run_id is not null
       group by c.run_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('date', d.date, 'feature', d.product, 'tokens', d.tokens) order by d.date), '[]'::jsonb)
      into v_daily
    from (
      select to_char(date_trunc('day', ch.created_at), 'YYYY-MM-DD') as date,
             coalesce(
               ch.product_code,
               rp.product,
               case
                 when ch.feature like 'blog%' then 'case_blog'
                 when ch.feature in ('health_checkup','disease_intro') or ch.feature like 'image%' then 'health_report'
                 when ch.feature like '%alimtalk%' then 'survey'
                 else 'etc'
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

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
              'createdAt', l.created_at, 'kind', l.kind, 'feature', l.feature, 'productCode', l.product_code,
              'tokens', l.tokens, 'balanceAfter', l.balance_after, 'runId', l.run_id,
              'ownerName', l.owner_name, 'patientName', l.patient_name) order by l.created_at desc), '[]'::jsonb)
      into v_ledger
    from (
      select base.created_at, base.kind, base.feature, base.product_code, base.tokens, base.balance_after, base.run_id,
             bi.owner_name, bi.patient_name
      from (
        select tl.created_at, tl.kind, tl.feature, tl.product_code, tl.tokens, tl.balance_after,
               (select u.run_id from billing.llm_usage u
                 where u.operation_id = tl.operation_id and u.run_id is not null limit 1) as run_id
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
end $function$;
