import { useEffect, useState } from 'react'
import { Download, LoaderCircle, Paperclip, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'

type AttachmentRow = {
  id: string
  original_name: string
  clean_mime: string
  clean_size: number
  uploaded_at: string
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 1) return 'Tamanho indisponível'
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export function CaseAttachmentsPanel({ reportId }: { reportId: string }) {
  const [items, setItems] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState('')
  const [feedback, setFeedback] = useState('')

  async function load() {
    if (!supabase) return
    setLoading(true)
    setFeedback('')
    const { data, error } = await supabase.rpc('operations_list_report_attachments', { p_report_id: reportId })
    if (error) {
      setItems([])
      setFeedback('Não foi possível carregar os anexos autorizados deste caso.')
    } else {
      setItems((data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        original_name: String(row.original_name ?? 'Anexo'),
        clean_mime: String(row.clean_mime ?? 'image/webp'),
        clean_size: Number(row.clean_size ?? 0),
        uploaded_at: String(row.uploaded_at ?? ''),
      })))
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [reportId])

  async function download(item: AttachmentRow) {
    if (!supabase || downloadingId) return
    setDownloadingId(item.id)
    setFeedback('')

    const { data, error } = await supabase.functions.invoke('get-report-attachment-url', {
      body: { attachmentId: item.id },
    })

    const url = data && typeof data === 'object' && typeof (data as { url?: unknown }).url === 'string'
      ? String((data as { url: string }).url)
      : ''

    if (error || !url) {
      setFeedback('Não foi possível gerar o download seguro deste anexo.')
      setDownloadingId('')
      return
    }

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.rel = 'noopener noreferrer'
    anchor.click()
    setDownloadingId('')
  }

  return (
    <article className="case-section attachment-panel">
      <div className="activity-heading">
        <div>
          <h3><Paperclip size={17} /> Anexos</h3>
          <span>Somente cópias sanitizadas são disponibilizadas na área interna.</span>
        </div>
        <button className="icon-action" onClick={() => void load()} type="button" aria-label="Atualizar anexos"><RefreshCw size={16} /></button>
      </div>

      <div className="attachment-security-note"><ShieldCheck size={16} /><span>O arquivo original permanece em quarentena privada e não é exposto pelo portal.</span></div>

      {loading
        ? <div className="activity-loading"><LoaderCircle className="spin" size={20} /> Carregando anexos</div>
        : items.length === 0
          ? <div className="activity-empty">Nenhum anexo sanitizado vinculado a este caso.</div>
          : <div className="attachment-list">{items.map((item) => (
              <div className="attachment-row" key={item.id}>
                <div><strong>{item.original_name}</strong><small>{formatBytes(item.clean_size)} • recebido em {formatDate(item.uploaded_at)}</small></div>
                <button className="button secondary compact" disabled={downloadingId === item.id} onClick={() => void download(item)} type="button">
                  {downloadingId === item.id ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />} Baixar cópia sanitizada
                </button>
              </div>
            ))}</div>}

      {feedback && <div className="activity-feedback" role="status">{feedback}</div>}
    </article>
  )
}
