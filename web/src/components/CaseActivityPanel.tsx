import { useEffect, useMemo, useState } from 'react'
import { Clock3, LoaderCircle, LockKeyhole, MessageSquareText, RefreshCw, Send, StickyNote } from 'lucide-react'
import { supabase } from '../lib/supabase'

type MessageVisibility = 'internal_only' | 'reporter_visible'

type ActivityEvent = {
  id: number
  eventType: string
  publicSummary: string | null
  internalMetadata: Record<string, unknown>
  createdByName: string | null
  createdAt: string
}

type ActivityMessage = {
  id: string
  authorType: 'reporter' | 'staff' | 'system'
  authorName: string
  visibility: MessageVisibility
  body: string
  createdAt: string
}

type Activity = {
  events: ActivityEvent[]
  messages: ActivityMessage[]
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).join(', ') : ''
}

function eventLabel(event: ActivityEvent) {
  const meta = event.internalMetadata ?? {}
  switch (event.eventType) {
    case 'report_received': return { title: 'Relato recebido', detail: event.publicSummary || 'O relato foi registrado.' }
    case 'status_changed': return { title: 'Status alterado', detail: event.publicSummary || `Status atualizado de ${String(meta.before ?? '')} para ${String(meta.after ?? '')}.` }
    case 'priority_changed': return { title: 'Prioridade alterada', detail: `Prioridade atualizada de ${String(meta.before ?? '')} para ${String(meta.after ?? '')}.` }
    case 'principal_assigned': return { title: 'Responsável principal atribuído', detail: `${String(meta.displayName ?? 'Usuário')} passou a responder pelo caso.` }
    case 'principal_revoked': return { title: 'Responsável principal removido', detail: `${String(meta.displayName ?? 'Usuário')} deixou de ser o responsável principal.` }
    case 'collaborator_added': return { title: 'Colaborador adicionado', detail: `${String(meta.displayName ?? 'Usuário')} foi adicionado à equipe do caso.` }
    case 'collaborator_removed': return { title: 'Colaborador removido', detail: `${String(meta.displayName ?? 'Usuário')} foi removido da equipe do caso.` }
    case 'observer_added': return { title: 'Observador adicionado', detail: `${String(meta.displayName ?? 'Usuário')} recebeu acompanhamento somente leitura deste caso.` }
    case 'observer_removed': return { title: 'Observador removido', detail: `${String(meta.displayName ?? 'Usuário')} deixou de acompanhar este caso.` }
    case 'internal_note_added': return { title: 'Nota interna registrada', detail: 'Uma nota interna foi adicionada ao caso.' }
    case 'staff_message_sent': return { title: 'Mensagem enviada ao denunciante', detail: 'A equipe enviou uma atualização pelo canal seguro.' }
    case 'reporter_message_received': return { title: 'Mensagem recebida do denunciante', detail: 'O denunciante enviou uma nova mensagem pelo protocolo.' }
    case 'collaborators_changed': {
      const added = textList(meta.addedNames)
      const removed = textList(meta.removedNames)
      return { title: 'Equipe atualizada', detail: [added ? `Adicionados: ${added}.` : '', removed ? `Removidos: ${removed}.` : ''].filter(Boolean).join(' ') || 'A equipe do caso foi atualizada.' }
    }
    case 'principal_changed': return { title: 'Responsável principal alterado', detail: `${String(meta.beforeName ?? 'Não atribuído')} → ${String(meta.afterName ?? 'Não atribuído')}` }
    default: return { title: event.eventType.replaceAll('_', ' '), detail: event.publicSummary || 'Evento interno registrado.' }
  }
}

export function CaseActivityPanel({ reportId, canAddNote, canMessageReporter }: { reportId: string; canAddNote: boolean; canMessageReporter: boolean }) {
  const [activity, setActivity] = useState<Activity>({ events: [], messages: [] })
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState<MessageVisibility>('internal_only')
  const [feedback, setFeedback] = useState('')

  async function load() {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase.rpc('operations_get_report_activity', { p_report_id: reportId })
    if (error || !data) {
      setFeedback('Não foi possível carregar a timeline e as mensagens deste caso.')
      setActivity({ events: [], messages: [] })
    } else {
      const parsed = data as unknown as Partial<Activity>
      setActivity({ events: parsed.events ?? [], messages: parsed.messages ?? [] })
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [reportId])

  useEffect(() => {
    if (!canMessageReporter && visibility === 'reporter_visible') setVisibility('internal_only')
  }, [canMessageReporter, visibility])

  async function send() {
    if (!supabase || sending || !body.trim()) return
    setSending(true)
    setFeedback('')
    const { error } = await supabase.rpc('operations_add_report_message', {
      p_report_id: reportId,
      p_visibility: visibility,
      p_body: body.trim(),
    })
    if (error) {
      setFeedback(visibility === 'internal_only' ? 'Não foi possível registrar a nota interna.' : 'Não foi possível enviar a mensagem ao denunciante.')
    } else {
      setBody('')
      setFeedback(visibility === 'internal_only' ? 'Nota interna registrada.' : 'Mensagem registrada no canal seguro do denunciante.')
      await load()
    }
    setSending(false)
  }

  const timeline = useMemo(() => [...activity.events].reverse(), [activity.events])

  return <div className="case-activity-grid">
    <article className="case-section activity-timeline-card">
      <div className="activity-heading"><div><h3><Clock3 size={17} /> Timeline</h3><span>Eventos operacionais e alterações da equipe.</span></div><button className="icon-action" onClick={() => void load()} type="button" aria-label="Atualizar atividade"><RefreshCw size={16} /></button></div>
      {loading ? <div className="activity-loading"><LoaderCircle className="spin" size={20} /> Carregando atividade</div> : timeline.length === 0 ? <div className="activity-empty">Nenhum evento registrado.</div> : <div className="activity-timeline">{timeline.map((event) => {
        const label = eventLabel(event)
        return <div className="activity-event" key={event.id}><span className="activity-dot" /><div><strong>{label.title}</strong><p>{label.detail}</p><small>{event.createdByName || 'Sistema'} • {formatDate(event.createdAt)}</small></div></div>
      })}</div>}
    </article>

    <article className="case-section activity-messages-card">
      <div className="activity-heading"><div><h3><MessageSquareText size={17} /> Comunicação</h3><span>Notas internas e conversa segura com o denunciante.</span></div></div>
      <div className="case-messages">{activity.messages.length === 0 ? <div className="activity-empty">Nenhuma mensagem registrada.</div> : activity.messages.map((message) => <div className={`case-message ${message.authorType} ${message.visibility}`} key={message.id}>
        <div className="case-message-meta"><strong>{message.authorName}</strong><span>{message.visibility === 'internal_only' ? <><LockKeyhole size={12} /> Nota interna</> : message.authorType === 'reporter' ? 'Denunciante' : 'Visível ao denunciante'}</span></div>
        <p>{message.body}</p><small>{formatDate(message.createdAt)}</small>
      </div>)}</div>

      {canAddNote && <div className="message-composer">
        <div className="message-kind">
          <button className={visibility === 'internal_only' ? 'active' : ''} onClick={() => setVisibility('internal_only')} type="button"><StickyNote size={15} /> Nota interna</button>
          {canMessageReporter && <button className={visibility === 'reporter_visible' ? 'active' : ''} onClick={() => setVisibility('reporter_visible')} type="button"><Send size={15} /> Mensagem ao denunciante</button>}
        </div>
        <textarea maxLength={8000} onChange={(event) => setBody(event.target.value)} placeholder={visibility === 'internal_only' ? 'Registre uma observação exclusiva da equipe autorizada.' : 'Escreva uma mensagem que ficará disponível no acompanhamento por protocolo.'} rows={4} value={body} />
        <div className="message-composer-actions"><small>{body.length}/8000</small><button className="button primary compact" disabled={sending || !body.trim()} onClick={() => void send()} type="button">{sending ? <LoaderCircle className="spin" size={15} /> : visibility === 'internal_only' ? <StickyNote size={15} /> : <Send size={15} />} {visibility === 'internal_only' ? 'Registrar nota' : 'Enviar mensagem'}</button></div>
      </div>}
      {feedback && <div className="activity-feedback" role="status">{feedback}</div>}
    </article>
  </div>
}
