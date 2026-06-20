import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * 내 병원이 해당 기능(번들)에 접근권 있는지 — 바른플랜 활성 OR 운영 패키지 구독.
 * 한 요청(렌더) 내에서 같은 키는 1회만 조회(cache). 조회 실패 시엔 막지 않는다(fail-open) —
 * 일시 장애로 정상 사용자가 잠기는 것을 피한다.
 */
export const hasFeature = cache(async (featureKey: string): Promise<boolean> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.schema('core').rpc('my_has_feature', { p_feature_key: featureKey });
    if (error) return true; // fail-open
    return data === true;
  } catch {
    return true; // fail-open
  }
});
