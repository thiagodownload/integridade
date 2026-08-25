import { useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle, LockKeyhole, ShieldAlert } from 'lucide-react'
import { StaffLoginPage } from '../pages/StaffLoginPage'
import { supabase, supabaseConfigured } from '../lib/supabase'

type InternalArea = 'operations' | 'admin'
type GateStatus = 'loading' | 'signed_out' | 'denied' | 'ready'

interface ProtectedInternalRouteProps {
  area: InternalArea
  children: ReactNode
}

const operationsRoles = new Set(['compliance_manager', 'investigator', 'privacy_officer'])

function canAccess(area: InternalArea, roles: string[]) {
  if (area === 'admin') return roles.includes('platform_admin')
  return roles.some((role) => operationsRoles.has(role))
}

export function ProtectedInternalRoute({ area, children }: ProtectedInternalRouteProps) {
  const [status, setStatus] = useState<GateStatus>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setStatus('signed_out')
      return
    }

    const client = supabase
    let active = true

    async function validateSession() {
      const { data: sessionData, error: sessionError } = await client.auth.getSession()
      if (!active) return

      if (sessionError || !sessionData.session) {
        setStatus('signed_out')
        return
      }

      const userId = sessionData.session.user.id
      const [profileResult, rolesResult] = await Promise.all([
        client.from('staff_profiles').select('active,display_name').eq('user_id', userId).maybeSingle(),
        client.from('staff_roles').select('role').eq('user_id', userId),
      ])

      if (!active) return

      if (profileResult.error || rolesResult.error || !profileResult.data?.active) {
        setMessage('Sua conta está autenticada, mas não possui um perfil interno ativo para este canal.')
        setStatus('denied')
        return
      }

      const roles = (rolesResult.data ?? []).map((item) => String(item.role))
      if (!canAccess(area, roles)) {
        setMessage(area === 'admin'
          ? 'Seu perfil não possui permissão de administração da plataforma.'
          : 'Seu perfil não possui permissão para a fila de atendimento.')
        setStatus('denied')
        return
      }

      setStatus('ready')
    }

    void validateSession()
    const { data: authListener } = client.auth.onAuthStateChange(() => {
      window.setTimeout(() => void validateSession(), 0)
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [area])

  if (!supabaseConfigured || !supabase || status === 'signed_out') return <StaffLoginPage />

  if (status === 'loading') {
    return (
      <main className="auth-page">
        <div className="auth-state-card" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={26} />
          <strong>Validando sessão e permissões</strong>
          <span>O acesso é conferido no Supabase antes de abrir a área interna.</span>
        </div>
      </main>
    )
  }

  if (status === 'denied') {
    return (
      <main className="auth-page">
        <section className="auth-state-card denied" aria-labelledby="access-denied-title">
          <span className="auth-state-icon"><ShieldAlert size={28} /></span>
          <strong id="access-denied-title">Acesso não autorizado</strong>
          <span>{message}</span>
          <div className="auth-state-actions">
            <a className="button secondary" href="#/"><LockKeyhole size={17} /> Voltar ao portal</a>
            <button className="button primary" type="button" onClick={async () => {
              await supabase.auth.signOut()
              window.location.hash = '/'
            }}>Sair da conta</button>
          </div>
        </section>
      </main>
    )
  }

  return <>{children}</>
}
