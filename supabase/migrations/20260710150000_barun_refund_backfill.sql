-- 소급 환불: admin 경로 추출 차감이 바른플랜 환불에서 누락된 과거분을 되돌린다.
--
-- 식별: kind='charge' + feature='extract' + product_code is null.
--   hospital-web(processExtractJob)은 항상 product 를 넘기므로, 이 조합은 admin-web 경로뿐이다.
--   (admin 은 오늘부터 product='admin_extract' 를 넘긴다 → 앞으로는 실시간 환불된다.)
--
-- 멱등: 같은 operation_id 에 barun_plan_refund 계열 adjust 가 하나라도 있으면 건너뛴다.
--   note 를 'barun_plan_refund_backfill' 로 남기되, 재실행 방지 조건은 두 note 를 모두 본다.
--   (조건과 기록이 어긋나면 재실행 때 이중 환불된다 — 돈이 걸린 곳이라 여기서 실수하면 안 된다.)
do $$
declare
  r record;
  v_balance numeric;
  v_count integer := 0;
  v_total numeric := 0;
begin
  for r in
    select l.hospital_id, l.operation_id, l.feature, l.product_code, (-l.tokens) as refund
      from billing.token_ledger l
      join core.hospitals h on h.id = l.hospital_id::text
     where l.kind = 'charge'
       and l.feature = 'extract'
       and l.product_code is null
       and h.barun_plan_enabled
       and (h.barun_plan_start is null or current_date >= h.barun_plan_start)
       and (h.barun_plan_end   is null or current_date <= h.barun_plan_end)
       and not exists (
         select 1 from billing.token_ledger x
          where x.operation_id = l.operation_id
            and x.kind = 'adjust'
            and x.note in ('barun_plan_refund', 'barun_plan_refund_backfill')
       )
     order by l.created_at
  loop
    update core.hospitals
       set token_balance = coalesce(token_balance, 0) + r.refund
     where id = r.hospital_id::text
     returning token_balance into v_balance;

    insert into billing.token_ledger
      (hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, note, product_code)
    values
      (r.hospital_id, r.operation_id, r.feature, 0, r.refund, v_balance, 'adjust',
       'barun_plan_refund_backfill', r.product_code);

    v_count := v_count + 1;
    v_total := v_total + r.refund;
  end loop;

  raise notice '소급 환불 완료: %건, 총 % 토큰', v_count, v_total;
end $$;
