import { FormEvent, useState } from 'react'
import { ArrowRight, MessageSquareText, Search, ShieldCheck } from 'lucide-react'

export function TrackPage() {
  const [protocol, setProtocol] = useState('')
  const [searched, setSearched] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!protocol.trim()) return
    setSearched(true)
  }

  return (
    <section className="track-page section-shell">
      <div className="page-heading centered-heading">
        <span className="eyebrow"><ShieldCheck size={16} /> Acompanhamento seguro</span>
        <h1>Consulte seu protocolo.</h1>
        <p>Não é necessário login. Trate o protocolo como uma credencial privada.</p>
      </div>

      <form className="track-card" onSubmit={submit}>
        <label className="field"><span>Protocolo</span><div className="input-with-icon"><Search size={18} /><input value={protocol} onChange={(event) => setProtocol(event.target.value.toUpperCase())} placeholder="CI-26-XXXX-XXXX-XXXX" autoComplete="off" required /></div></label>
        <button className="button primary" type="submit">Consultar <ArrowRight size={18} /></button>
      </form>

      {searched && (
        <article className="tracking-result">
          <header><div><small>Protocolo</small><strong>{protocol}</strong></div><span className="status warning">Em apuração</span></header>
          <div className="timeline">
            <div className="timeline-row done"><span /><div><strong>Relato recebido</strong><p>O registro foi criado e encaminhado para triagem.</p><small>24/08/2026 • 14:18</small></div></div>
            <div className="timeline-row done"><span /><div><strong>Triagem concluída</strong><p>A equipe responsável iniciou a análise.</p><small>24/08/2026 • 15:03</small></div></div>
            <div className="timeline-row current"><span /><div><strong>Nova pergunta da equipe</strong><p>Existe uma atualização aguardando sua resposta.</p><small>24/08/2026 • 18:21</small></div></div>
          </div>
          <div className="reply-box"><MessageSquareText size={20} /><div><strong>Responder sem se identificar</strong><textarea rows={4} placeholder="Digite sua resposta. Ela será vinculada apenas ao protocolo." /><button className="button primary compact" type="button">Enviar resposta</button></div></div>
        </article>
      )}
    </section>
  )
}
