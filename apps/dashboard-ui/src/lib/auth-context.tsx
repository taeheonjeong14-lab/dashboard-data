"use client"
import { createContext, useContext } from 'react'
import type { HospitalScope } from './queries'

type AuthContextValue = {
  scope: HospitalScope
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  scope,
  children,
}: {
  scope: HospitalScope
  children: React.ReactNode
}) {
  return <AuthContext.Provider value={{ scope }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
