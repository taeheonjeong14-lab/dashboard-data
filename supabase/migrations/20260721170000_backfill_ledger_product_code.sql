-- 과거 무라벨(product_code IS NULL) charge 행에 product_code 를 소급 채운다(라벨만 — 잔액·환불 불변).
-- 근거: ① feature 로 확실한 것(blog*/case_doc→case_blog, health_checkup/disease_intro→health_report)
--       ② extract/image_analysis 는 그 run 이 생성한 콘텐츠(generated_run_content)로 판정
--       ③ kakao_alimtalk 은 run 있으면 리포트 발송(health_report), 없으면 사전문진(survey)
-- 근거 없는 extract(콘텐츠 미생성=버려진 추출)는 null 유지(추측으로 오염시키지 않음).
-- 멱등: product_code IS NULL 인 charge 만 대상.
with nullc as (
  select l.id, l.feature,
    (select u.run_id from billing.llm_usage u
      where u.operation_id = l.operation_id and u.run_id is not null limit 1) as run_id
  from billing.token_ledger l
  where l.kind = 'charge' and l.product_code is null
),
runprod as (
  select parse_run_id,
    case
      when bool_or(content_type like 'blog%') then 'case_blog'
      when bool_or(content_type in ('health_checkup','health_points','hospital_notes','disease_intro')) then 'health_report'
      else null
    end as product
  from health_report.generated_run_content
  group by parse_run_id
),
mapped as (
  select n.id,
    case
      when n.feature like 'blog%' or n.feature = 'case_doc' then 'case_blog'
      when n.feature in ('health_checkup','disease_intro') then 'health_report'
      when n.feature in ('extract','image_analysis') then rp.product
      when n.feature = 'kakao_alimtalk' then case when n.run_id is not null then 'health_report' else 'survey' end
      else null
    end as intended
  from nullc n
  left join runprod rp on rp.parse_run_id = n.run_id
)
update billing.token_ledger t
   set product_code = m.intended
  from mapped m
 where t.id = m.id and m.intended is not null and t.product_code is null;
