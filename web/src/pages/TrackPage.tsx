import { type FormEvent, useState } from 'react'
import { ArrowRight, LoaderCircle, MessageSquareText, Search, ShieldCheck } from 'lucide-react'

type TrackResult = {
  found: boolean
  report?: { status: string; createdAt: string; closedAt: string | null }
  timeline?: Array<{ event_type: string; public_summary: string | null; created_at: string }>
  messages?: Array<{ id: string; author_type: 'reporter' | 'staff' | 'system'; body: string; created_at: string }>
}

const statusLabels: Record<string, string> = {
  new: 'Recebido',
  triage: 'Em triagem',
  investigating: 'Em análise',
  waiting_reporter: 'Aguardando sua resposta',
  waiting_internal: 'Em análise interna',
  resolved: 'Concluído',
  closed: 'Encerrado',
  dismissed: 'Análise concluída',
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function publicError(status: number, code: string) {
  if (status === 429 || code === 'too_many_requests') return 'Foram feitas muitas consultas recentemente. Aguarde um pouco antes de tentar novamente.'
  if (code === 'gateway_authentication_failed') return 'O gateway seguro não conseguiu validar esta solicitação.'
  return 'Não foi possível consultar o protocolo agora. Tente novamente em alguns instantes.'
}

export function TrackPage() {
  const [protocol, setProtocol] = useState('')
  const [result, setResult] = useState<TrackResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [replying, setReplying] = useState(false)
  const [replyFeedback, setReplyFeedback] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!protocol.trim() || loading) return
    setLoading(true)
    setError('')
    setResult(null)
    setReplyFeedback('')

    try {
      const response = await fetch('/api/public/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: protocol.trim().toUpperCase() }),
      })
      const parsed = await response.json().catch(() => ({})) as TrackResult & { error?: string }

      if (!response.ok) {
        setError(publicError(response.status, parsed.error ?? ''))
        return
      }
      if (!parsed?.found) {
        setError('Não foi possível localizar um relato com esse protocolo. Confira os caracteres e tente novamente.')
        return
      }
      setResult(parsed)
    } catch {
      setError('Não foi possível alcançar o canal seguro agora.')
    } finally {
      setLoading(false)
    }
  }

  async function sendReply() {
    if (!result?.found || !replyBody.trim() || replying) return
    setReplying(true)
    setReplyFeedback('')

    try {
      const response = await fetch('/api/public/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: protocol.trim().toUpperCase(), body: replyBody.trim() }),
      })
      const body = await response.json().catch(() => ({})) as { accepted?: boolean; error?: string }
      if (!response.ok || body.accepted !== true) {
        setReplyFeedback(publicError(response.status, body.error ?? ''))
        return
      }
      setReplyBody('')
      setReplyFeedback('Mensagem recebida pelo canal seguro. Consulte novamente para atualizar o histórico.')
    } catch {
      setReplyFeedback('Não foi possível enviar sua mensagem agora.')
    } finally {
      setReplying(false)
    }
  }

  return (
    <section className="track-page section-shell">
      <div className="page-heading centered-heading">
        <span className="eyebrow"><ShieldCheck size={16} /> Acompanhamento seguro</span>
        <h1>Consulte seu protocolo.</h1>
        <p>Não é necessário login. Trate o protocolo como uma credencial privada.</p>
      </div>

      <form className="track-card" onSubmit={(event) => void submit(event)}>
        <label className="field"><span>Protocolo</span><div className="input-with-icon"><Search size={18} /><input value={protocol} onChange={(event) => setProtocol(event.target.value.toUpperCase())} placeholder="CI-26-XXXX-XXXX-XXXX-XXXX" autoComplete="off" required /></div></label>
        <button className="button primary" disabled={loading} type="submit">{loading ? <LoaderCircle className="spin" size={18} /> : <>Consultar <ArrowRight size={18} /></>}</button>
      </form>

      {error && <div className="warning-note" role="status"><ShieldCheck size={18} /><p>{error}</p></div>}

      {result?.found && result.report && (
        <article className="tracking-result">
          <header><div><small>Protocolo</small><strong>{protocol.trim().toUpperCase()}</strong></div><span className="status warning">{statusLabels[result.report.status] ?? result.report.status}</span></header>

          <div className="timeline">
            {(result.timeline ?? []).length === 0
              ? <div className="timeline-row current"><span /><div><strong>Relato localizado</strong><p>Ainda não existem atualizações públicas adicionais.</p><small>{formatDate(result.report.createdAt)}</small></div></div>
              : (result.timeline ?? []).map((item, index) => <div className={`timeline-row ${index === (result.timeline ?? []).length - 1 ? 'current' : 'done'}`} key={`${item.event_type}-${item.created_at}-${index}`}><span /><div><strong>{item.event_type.replaceAll('_', ' ')}</strong><p>{item.public_summary || 'Atualização registrada.'}</p><small>{formatDate(item.created_at)}</small></div></div>)}
          </div>

          {(result.messages ?? []).length > 0 && <div className="public-message-history">{(result.messages ?? []).map((message) => <div className={`public-message ${message.author_type}`} key={message.id}><strong>{message.author_type === 'reporter' ? 'Você' : 'Equipe do canal'}</strong><p>{message.body}</p><small>{formatDate(message.created_at)}</small></div>)}</div>}

          <div className="reply-box"><MessageSquareText size={20} /><div><strong>Responder sem se identificar</strong><textarea maxLength={8000} rows={4} placeholder="Digite sua resposta. Ela será vinculada apenas ao protocolo." value={replyBody} onChange={(event) => setReplyBody(event.target.value)} /><button className="button primary compact" disabled={replying || !replyBody.trim()} onClick={() => void sendReply()} type="button">{replying ? <LoaderCircle className="spin" size={16} /> : 'Enviar resposta'}</button>{replyFeedback && <p className="field-help">{replyFeedback}</p>}</div></div>
        </article>
      )}
    </section>
  )
}
