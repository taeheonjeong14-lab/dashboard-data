-- 상품(product) 명시적 라벨링: 차감을 기록할 때 어떤 "상품"인지 product_code 로 박는다.
-- 읽을 때 피처·run 으로 추측하던 방식 → 쓸 때 라벨링. 새 상품/알림톡 부착이 RPC 수정 없이 동작.
-- product_code: 'case_blog'(진료케이스) | 'health_report'(건강검진 리포트) | 'survey'(사전문진) | ...
alter table billing.token_ledger      add column if not exists product_code text;
alter table health_report.alimtalk_outbox add column if not exists product_code text;

-- 옛 시그니처 제거(모호성 방지). 드롭 후 4-arg 호출은 새 default 버전(p_product=null)으로 resolve 되어
-- 기존 chart-api 배포본도 그대로 동작한다.
drop function if exists billing.token_charge_operation(text, uuid, text, numeric);
drop function if exists core.charge_alimtalk_cost(text, uuid, numeric, uuid, numeric);

-- token_charge_operation: p_product 받음. 없으면 피처에서 유추(콘텐츠 차감은 피처가 곧 상품).
--   추출/알림톡처럼 피처로 상품을 알 수 없는 건 호출부가 p_product 를 넘긴다.
create or replace function billing.token_charge_operation(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_feature         text default null,
  p_token_value_usd numeric default 0.01,
  p_product         text default null
) returns table(tokens numeric, balance_after numeric, cost_usd numeric)
language plpgsql security definer as $$
declare
  v_cost          numeric;
  v_tokens        numeric;
  v_balance       numeric;
  v_is_case_write boolean;
  v_is_case       boolean;
  v_refund        boolean;
  v_product       text;
begin
  if p_hospital_id is null or p_operation_id is null then
    return;
  end if;
  if exists (select 1 from billing.token_ledger l where l.operation_id = p_operation_id and l.kind = 'charge') then
    return;
  end if;
  select coalesce(sum(u.cost_usd), 0) into v_cost
    from billing.llm_usage u
   where u.operation_id = p_operation_id and u.hospital_id = p_hospital_id::uuid;
  if v_cost <= 0 then
    return;
  end if;

  v_is_case_write := p_feature in ('blog_causal', 'blog_detail', 'blog_outline', 'blog_post');
  v_is_case       := p_feature like 'blog%';
  v_tokens        := ceil(v_cost / nullif(p_token_value_usd, 0));
  if v_is_case_write then
    v_tokens := v_tokens * 30;
  end if;
  if v_tokens <= 0 then
    return;
  end if;

  -- 상품 라벨: 명시값 우선, 없으면 피처에서 유추(콘텐츠 차감).
  v_product := coalesce(
    p_product,
    case
      when p_feature like 'blog%' then 'case_blog'
      when p_feature in ('health_checkup','disease_intro') or p_feature like 'image%' then 'health_report'
      else null
    end
  );

  update core.hospitals
     set token_balance = coalesce(token_balance, 0) - v_tokens
   where id = p_hospital_id
   returning token_balance into v_balance;
  insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, product_code)
    values (p_hospital_id::uuid, p_operation_id, p_feature, v_cost, -v_tokens, v_balance, 'charge', v_product);

  if v_is_case then
    select (h.barun_plan_enabled
            and (h.barun_plan_start is null or current_date >= h.barun_plan_start)
            and (h.barun_plan_end   is null or current_date <= h.barun_plan_end))
      into v_refund from core.hospitals h where h.id = p_hospital_id;
    if coalesce(v_refund, false) then
      update core.hospitals
         set token_balance = coalesce(token_balance, 0) + v_tokens
       where id = p_hospital_id
       returning token_balance into v_balance;
      insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, note, product_code)
        values (p_hospital_id::uuid, p_operation_id, p_feature, 0, v_tokens, v_balance, 'adjust', 'barun_plan_refund', v_product);
    end if;
  end if;

  return query select v_tokens, v_balance, v_cost;
end $$;

grant execute on function billing.token_charge_operation(text, uuid, text, numeric, text) to service_role;

-- charge_alimtalk_cost: p_product 받아 token_charge_operation 으로 전달.
create or replace function core.charge_alimtalk_cost(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_cost_krw        numeric,
  p_run_id          uuid default null,
  p_token_value_usd numeric default 0.001,
  p_product         text default null
) returns void
language plpgsql security definer
set search_path = core, billing, public
as $func$
declare
  v_cost_usd numeric;
begin
  if p_hospital_id is null or p_operation_id is null or p_cost_krw is null or p_cost_krw <= 0 then
    return;
  end if;
  v_cost_usd := round(p_cost_krw, 0) * p_token_value_usd;
  if exists (select 1 from billing.llm_usage u where u.operation_id = p_operation_id and u.feature = 'kakao_alimtalk') then
    return;
  end if;
  insert into billing.llm_usage (hospital_id, feature, operation_id, run_id, provider, model, units, cost_usd)
    values (p_hospital_id::uuid, 'kakao_alimtalk', p_operation_id, p_run_id, 'aligo', 'alimtalk', 1, v_cost_usd);
  perform billing.token_charge_operation(p_hospital_id, p_operation_id, 'kakao_alimtalk', p_token_value_usd, p_product);
end $func$;

grant execute on function core.charge_alimtalk_cost(text, uuid, numeric, uuid, numeric, text) to service_role;

-- my_usage_overview daily: product_code 우선, 없으면(레거시) run/피처로 폴백. 상품 "코드"를 내려준다.
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
end $func$;

grant execute on function core.my_usage_overview(int) to authenticated;
