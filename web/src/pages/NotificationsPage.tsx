import { useEffect, useMemo, useState } from 'react'
import { Bell, BellRing, CheckCheck, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { InternalShell } from '../components/InternalShell'
import { supabase } from '../lib/supabase'

type NotificationRow = {
  id: number
  eventType: string
  reportId: string | null
  payload: Record<string, unknown> | null
  createdAt: string
  readAt: string | null
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function notificationText(item: NotificationRow) {
  if (item.eventType === 'report.created') return { title: 'Novo relato recebido', description: 'Há um novo relato aguardando triagem.' }
  if (item.eventType === 'report.restricted.created') return { title: 'Novo item restrito recebido', description: 'Há um novo item restrito aguardando tratamento autorizado.' }
  if (item.eventType === 'report.message.created') return { title: 'Nova mensagem recebida', description: 'O denunciante enviou uma nova mensagem em um relato acessível ao seu perfil.' }
  if (item.eventType === 'report.assignment.granted') {
    const type = String(item.payload?.assignment_type ?? 'collaborator')
    if (type === 'principal') return { title: 'Nova responsabilidade', description: 'Você foi definido como responsável principal por um caso.' }
    if (type === 'observer') return { title: 'Novo acompanhamento', description: 'Você recebeu acesso de acompanhamento a um caso.' }
    return { title: 'Novo caso atribuído', description: 'Você foi adicionado como colaborador em um caso.' }
  }
  return { title: 'Atualização do Canal de Integridade', description: 'Há uma nova atualização disponível na área interna.' }
}

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission
  })

  const unread = useMemo(() => items.filter((item) => !item.readAt).length, [items])

  async function load() {
    if (!supabase) return
    setLoading(true)
    setFeedback('')
    const { data, error } = await supabase.rpc('staff_list_notifications', { p_limit: 50 })
    if (error) {
      setItems([])
      setFeedback('Não foi possível carregar as notificações desta sessão.')
    } else {
      setItems((data ?? []).map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        eventType: String(row.event_type ?? ''),
        reportId: row.report_id == null ? null : String(row.report_id),
        payload: row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : null,
        createdAt: String(row.created_at ?? ''),
        readAt: row.read_at == null ? null : String(row.read_at),
      })))
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  async function enableBrowserNotifications() {
    if (typeof Notification === 'undefined') {
      setPermission('unsupported')
      setFeedback('Este navegador não oferece notificações nativas para o portal.')
      return
    }
    const result = await Notification.requestPermission()
    setPermission(result)
    setFeedback(result === 'granted'
      ? 'Notificações do navegador ativadas neste dispositivo.'
      : result === 'denied'
        ? 'O navegador bloqueou as notificações. A central interna continuará funcionando normalmente.'
        : 'A permissão de notificações não foi concedida.')
  }

  async function markRead(item: NotificationRow, openOperations = false) {
    if (!supabase) return
    if (!item.readAt) await supabase.rpc('staff_mark_notification_read', { p_notification_id: item.id })
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, readAt: row.readAt ?? new Date().toISOString() } : row))
    if (openOperations) window.location.hash = '/operacoes'
  }

  async function markAllRead() {
    if (!supabase) return
    const { error } = await supabase.rpc('staff_mark_all_notifications_read')
    if (error) {
      setFeedback('Não foi possível marcar todas as notificações como lidas.')
      return
    }
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })))
    setFeedback('Todas as notificações foram marcadas como lidas.')
  }

  return (
    <InternalShell active="notifications">
      <div className="internal-header notifications-header">
        <div>
          <span className="eyebrow">Área interna</span>
          <h1>Notificações</h1>
          <p>Avisos operacionais individualizados, sem expor conteúdo sensível fora do tratamento do caso.</p>
        </div>
        <button className="button secondary" disabled={loading} onClick={() => void load()} type="button">
          {loading ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />} Atualizar
        </button>
      </div>

      <section className="dashboard-card notification-browser-card">
        <div>
          <span className="notification-icon"><BellRing size={20} /></span>
          <div>
            <strong>Avisos do navegador</strong>
            <span>{permission === 'granted'
              ? 'Ativos neste navegador enquanto o portal estiver aberto.'
              : permission === 'denied'
                ? 'Bloqueados nas permissões deste navegador.'
                : permission === 'unsupported'
                  ? 'Não disponíveis neste navegador.'
                  : 'Opcional. O portal só pedirá permissão quando você clicar em ativar.'}</span>
          </div>
        </div>
        {permission === 'default' && <button className="button primary compact" onClick={() => void enableBrowserNotifications()} type="button"><Bell size={16} /> Ativar notificações do navegador</button>}
        {permission === 'granted' && <span className="status success"><ShieldCheck size={14} /> Ativas</span>}
      </section>

      {feedback && <div className="operations-feedback" role="status">{feedback}</div>}

      <section className="dashboard-card notifications-card">
        <header className="card-header">
          <div><strong>Central de avisos</strong><span>{unread} não {unread === 1 ? 'lida' : 'lidas'} • {items.length} carregadas</span></div>
          {unread > 0 && <button className="button secondary compact" onClick={() => void markAllRead()} type="button"><CheckCheck size={16} /> Marcar todas como lidas</button>}
        </header>

        {loading
          ? <div className="operations-empty"><LoaderCircle className="spin" size={24} /><strong>Carregando notificações</strong></div>
          : items.length === 0
            ? <div className="operations-empty"><Bell size={26} /><strong>Nenhuma notificação</strong><span>Novos relatos, mensagens e atribuições aparecerão aqui quando forem destinados ao seu perfil.</span></div>
            : <div className="notification-list">{items.map((item) => {
                const text = notificationText(item)
                return (
                  <article className={`notification-item ${item.readAt ? 'read' : 'unread'}`} key={item.id}>
                    <span className="notification-dot" aria-hidden="true" />
                    <div className="notification-copy">
                      <div><strong>{text.title}</strong>{!item.readAt && <span className="notification-unread-label">Nova</span>}</div>
                      <p>{text.description}</p>
                      <small>{formatDate(item.createdAt)}</small>
                    </div>
                    <div className="notification-actions">
                      {!item.readAt && <button className="button secondary compact" onClick={() => void markRead(item)} type="button">Marcar como lida</button>}
                      {item.reportId && <button className="button primary compact" onClick={() => void markRead(item, true)} type="button">Ir para Operações</button>}
                    </div>
                  </article>
                )
              })}</div>}
      </section>
    </InternalShell>
  )
}
