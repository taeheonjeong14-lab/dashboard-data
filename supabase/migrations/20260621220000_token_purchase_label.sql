-- 입금확인 충전을 '토큰 구매'로 구분되게 — feature='token_purchase' 로 기록.
-- (직접 관리자 지급 token_grant 는 feature=null → '관리자 지급')
create or replace function billing.confirm_token_order(p_order_id uuid, p_admin uuid)
returns text
language plpgsql security definer set search_path = billing, core, public
as $$
declare o billing.token_orders; v_bal numeric;
begin
  select * into o from billing.token_orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status <> 'pending' then return 'not_pending'; end if;

  update core.hospitals set token_balance = coalesce(token_balance, 0) + o.total_tokens
   where id = o.hospital_id::text returning token_balance into v_bal;
  insert into billing.token_ledger(hospital_id, feature, tokens, balance_after, kind, note)
    values (o.hospital_id, 'token_purchase', o.total_tokens, v_bal, 'grant', '토큰 구매 ' || o.order_no);

  update billing.token_orders set status = 'paid', paid_at = now(), paid_by = p_admin where id = o.id;
  return 'ok';
end $$;
