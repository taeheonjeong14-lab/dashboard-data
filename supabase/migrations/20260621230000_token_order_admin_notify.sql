-- 토큰 구매 주문 생성 시 admin 들에게 '입금 확인 요청' 알림.
create or replace function billing.create_token_order(p_hospital_id uuid, p_package_id text, p_created_by uuid)
returns jsonb
language plpgsql security definer set search_path = billing, core, public
as $$
declare pk record; v_no text; v_row billing.token_orders;
begin
  select * into pk from billing.token_packages where id = p_package_id and active;
  if not found then return jsonb_build_object('error', 'invalid_package'); end if;
  v_no := to_char(now() at time zone 'Asia/Seoul', 'YYYY') || '-' || lpad(nextval('billing.token_order_seq')::text, 4, '0');
  insert into billing.token_orders(order_no, hospital_id, package_id, base_tokens, bonus_tokens, total_tokens, price_krw, created_by)
    values (v_no, p_hospital_id, pk.id, pk.base_tokens, pk.bonus_tokens, pk.base_tokens + pk.bonus_tokens, pk.price_krw, p_created_by)
    returning * into v_row;

  -- admin 입금확인 요청 알림(실패가 주문을 막지 않도록 예외 무시)
  begin
    insert into core.notifications (user_id, hospital_id, type, title, body, link)
    select au.id, p_hospital_id, 'token_order_pending', '토큰 구매 입금 확인 요청',
           coalesce((select name from core.hospitals where id = p_hospital_id::text), '병원')
             || ' · ' || v_row.total_tokens || '토큰 (' || to_char(v_row.price_krw, 'FM999,999,999') || '원) · #' || v_row.order_no
             || ' — 입금 확인 후 승인해 주세요.',
           '/admin/usage'
      from core.admin_users au;
  exception when others then null;
  end;

  return jsonb_build_object('orderNo', v_row.order_no, 'totalTokens', v_row.total_tokens,
    'baseTokens', v_row.base_tokens, 'bonusTokens', v_row.bonus_tokens, 'priceKrw', v_row.price_krw, 'status', v_row.status);
end $$;
