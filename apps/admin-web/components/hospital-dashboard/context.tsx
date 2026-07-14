'use client';

/**
 * 복사해 온 hospital 대시보드 컴포넌트가 쓰는 useHospital() 자리를 메운다.
 * hospital 은 로그인한 병원이 하나라 컨텍스트에서 읽지만, admin 은 URL 의 병원을 본다.
 */
import { useParams } from 'next/navigation';

export function useHospital(): { hospitalId: string | null } {
  const params = useParams();
  const id = typeof params.hospitalId === 'string' ? params.hospitalId : '';
  return { hospitalId: id || null };
}
