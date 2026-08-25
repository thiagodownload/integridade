import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bell, Gauge, LogOut, Settings, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface InternalShellProps {
  active: 'operations' | 'admin'
  children: ReactNode
}

const roleLabels: Record<string, string> = {
  platform_admin: 'Administrador da plataforma',
  compliance_manager: 'Gestor de Compliance',
  investigator: 'Investigador',
  auditor: 'Auditor',
  privacy_officer: 'Privacidade / triagem restrita',
}

export function InternalShell({ active, children }: InternalShellProps) {
  const [email, setEmail] = useState('Usuário autorizado')
  const [roles, setRoles] = useState<string[]>([])

  useEffect(() => {
    if (!supabase) return

    let activeEffect = true
    const client = supabase

    async function loadIdentity() {
      const { data } = await client.auth.getSession()
      const session = data.session
      if (!activeEffect || !session) return

      setEmail(session.user.email || 'Usuário autorizado')
      const { data: roleRows } = await client.from('staff_roles').select('role').eq('user_id', session.user.id)
      if (!activeEffect) return
      setRoles((roleRows ?? []).map((row) => String(row.role)))
    }

    void loadIdentity()
    return () => {
      activeEffect = false
    }
  }, [])

  const initials = useMemo(() => {
    const source = email.split('@')[0]?.replace(/[^a-zA-Z0-9]+/g, ' ').trim() || 'IA'
    const parts = source.split(/\s+/).filter(Boolean)
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toUpperCase()
  }, [email])

  const primaryRole = roles.map((role) => roleLabels[role]).find(Boolean) || 'Perfil interno'
  const canAdmin = roles.includes('platform_admin')

  async function handleSignOut() {
    await supabase?.auth.signOut()
    window.location.hash = '/'
  }

  return (
    <div className="internal-layout">
      <aside className="internal-sidebar">
        <a className="internal-brand" href="#/operacoes">
          <span className="brand-icon"><ShieldCheck size={21} /></span>
          <span><strong>Integridade</strong><small>Área interna</small></span>
        </a>
        <nav className="internal-nav" aria-label="Área interna">
          <a className={active === 'operations' ? 'active' : ''} href="#/operacoes"><Gauge size={18} /> Operações</a>
          <a href="#/operacoes"><Bell size={18} /> Notificações <span className="nav-count">0</span></a>
          {canAdmin && <a className={active === 'admin' ? 'active' : ''} href="#/admin"><Settings size={18} /> Administração</a>}
        </nav>
        <div className="internal-user">
          <span className="avatar">{initials}</span>
          <div><strong title={email}>{email}</strong><small>{primaryRole}</small></div>
          <button type="button" aria-label="Sair" title="Sair" onClick={handleSignOut}><LogOut size={17} /></button>
        </div>
      </aside>
      <main className="internal-content">{children}</main>
    </div>
  )
}
