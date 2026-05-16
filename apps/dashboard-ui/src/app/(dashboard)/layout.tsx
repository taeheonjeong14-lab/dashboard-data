import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase-server'
import { fetchHospitalScopeServer } from '@/lib/scope-server'
import { AuthProvider } from '@/lib/auth-context'
import DashboardShell from '@/components/DashboardShell'

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const scope = await fetchHospitalScopeServer(user)

  return (
    <AuthProvider scope={scope}>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  )
}
