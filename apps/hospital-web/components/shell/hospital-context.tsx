'use client';

import { createContext, useContext, type ReactNode } from 'react';

// 서버 레이아웃에서 한 번 조회한 userId/hospitalId 를 클라이언트 페이지로 내려준다.
// 각 페이지가 supabase.auth.getUser()(인증 서버 왕복) + core.users 프로필 조회를
// 반복하지 않도록 해 데이터 패칭 워터폴을 단축한다.
type HospitalCtx = { userId: string | null; hospitalId: string | null };

const Ctx = createContext<HospitalCtx>({ userId: null, hospitalId: null });

export function HospitalProvider({
  userId,
  hospitalId,
  children,
}: HospitalCtx & { children: ReactNode }) {
  return <Ctx.Provider value={{ userId, hospitalId }}>{children}</Ctx.Provider>;
}

export function useHospital(): HospitalCtx {
  return useContext(Ctx);
}
