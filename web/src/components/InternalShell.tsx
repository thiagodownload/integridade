import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bell, Gauge, LogOut, Settings, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface InternalShellProps {
  active: 'operations' | 'notifications' | 'admin'
  children: ReactNode
}

type NotificationRow = {
  id: number
  event_type: string
  payload: Record<string, unknown> | null
  read_at: string | null
}

const roleLabels: Record<string, string> = {
  platform_admin: 'Administrador da plataforma',
  compliance_manager: 'Gestor de Compliance',
  investigator: 'Investigador',
  auditor: 'Auditor',
  privacy_officer: 'Privacidade / triagem restrita',
  executive_viewer: 'Diretoria / Acompanhamento Executivo',
}

function browserNotificationText(item: NotificationRow) {
  if (item.event_type === 'report.created') return { title: 'Novo relato recebido', body: 'Há um novo relato aguardando triagem no Canal de Integridade.' }
  if (item.event_type === 'report.restricted.created') return { title: 'Novo item restrito recebido', body: 'Há um novo item restrito aguardando tratamento autorizado.' }
  if (item.event_type === 'report.message.created') return { title: 'Nova mensagem recebida', body: 'Há uma nova mensagem em um relato que você pode acompanhar.' }
  if (item.event_type === 'report.assignment.granted') {
    const type = String(item.payload?.assignment_type ?? 'collaborator')
    if (type === 'principal') return { title: 'Nova responsabilidade', body: 'Você foi definido como responsável principal por um caso.' }
    if (type === 'observer') return { title: 'Novo acompanhamento', body: 'Você recebeu acesso de acompanhamento a um caso.' }
    return { title: 'Novo caso atribuído', body: 'Você foi adicionado como colaborador em um caso.' }
  }
  return { title: 'Nova atualização', body: 'Há uma nova atualização no Canal de Integridade.' }
}

export function InternalShell({ active, children }: InternalShellProps) {
  const [email, setEmail] = useState('Usuário autorizado')
  const [roles, setRoles] = useState<string[]>([])
  const [mfaActive, setMfaActive] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!supabase) return

    let activeEffect = true
    let timer = 0
    const client = supabase

    async function refreshNotifications(userId: string, allowPopup: boolean) {
      const [countResult, listResult] = await Promise.all([
        client.rpc('staff_unread_notification_count'),
        client.rpc('staff_list_notifications', { p_limit: 20 }),
      ])
      if (!activeEffect || countResult.error || listResult.error) return

      setUnreadCount(Number(countResult.data ?? 0))
      const rows = (listResult.data ?? []).map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        event_type: String(row.event_type ?? ''),
        payload: row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : null,
        read_at: row.read_at == null ? null : String(row.read_at),
      })) as NotificationRow[]

      const key = `integridade:last-notification:${userId}`
      const highestId = rows.reduce((max, row) => Math.max(max, row.id), 0)
      const storedPrevious = window.localStorage.getItem(key)

      if (storedPrevious === null) {
        window.localStorage.setItem(key, String(highestId))
        return
      }

      const previous = Number(storedPrevious)
      const newUnread = rows
        .filter((row) => row.read_at == null && row.id > previous)
        .sort((a, b) => a.id - b.id)

      if (allowPopup && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        for (const item of newUnread) {
          const text = browserNotificationText(item)
          const notification = new Notification(text.title, { body: text.body, tag: `integridade-${item.id}` })
          notification.onclick = () => {
            window.focus()
            window.location.hash = '/notificacoes'
            notification.close()
          }
        }
      }

      if (highestId > previous) window.localStorage.setItem(key, String(highestId))
    }

    async function loadIdentity() {
      const { data } = await client.auth.getSession()
      const session = data.session
      if (!activeEffect || !session) return

      setEmail(session.user.email || 'Usuário autorizado')

      const [roleResult, aalResult] = await Promise.all([
        client.from('staff_roles').select('role').eq('user_id', session.user.id),
        client.auth.mfa.getAuthenticatorAssuranceLevel(),
      ])

      if (!activeEffect) return
      setRoles((roleResult.data ?? []).map((row) => String(row.role)))
      const aal2 = !aalResult.error && aalResult.data.currentLevel === 'aal2'
      setMfaActive(aal2)

      if (aal2) {
        await refreshNotifications(session.user.id, false)
        timer = window.setInterval(() => void refreshNotifications(session.user.id, true), 15_000)
      }
    }

    void loadIdentity()
    return () => {
      activeEffect = false
      if (timer) window.clearInterval(timer)
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
          <a className={active === 'notifications' ? 'active' : ''} href="#/notificacoes"><Bell size={18} /> Notificações <span className="nav-count">{unreadCount > 99 ? '99+' : unreadCount}</span></a>
          {canAdmin && <a className={active === 'admin' ? 'active' : ''} href="#/admin"><Settings size={18} /> Administração</a>}
        </nav>
        <div className="internal-user">
          <span className="avatar">{initials}</span>
          <div>
            <strong title={email}>{email}</strong>
            <small>{primaryRole}</small>
            {mfaActive && <small className="internal-mfa-badge"><ShieldCheck size={12} /> MFA ativo</small>}
          </div>
          <button type="button" aria-label="Sair" title="Sair" onClick={handleSignOut}><LogOut size={17} /></button>
        </div>
      </aside>
      <main className="internal-content">{children}</main>
    </div>
  )
}
