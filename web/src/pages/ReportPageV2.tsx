import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FileArchive,
  LoaderCircle,
  LockKeyhole,
  Paperclip,
  ShieldCheck,
  Trash2,
} from 'lucide-react'

type PublicCategory = {
  id: string
  name: string
  description: string | null
}

type PublicConfig = {
  organizationSlug: string
  publicName: string
  welcomeText: string
  allowAnonymous: boolean
  allowOptionalEmail: boolean
  allowAttachments: boolean
  privacyNoticeVersion: string
  categories: PublicCategory[]
}

type AttachmentState = 'idle' | 'uploading' | 'done'

type AttachmentResult = {
  name: string
  ok: boolean
}

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024
const MAX_ATTACHMENTS = 5
const ACCEPTED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp',
  'pdf', 'docx', 'xlsx', 'pptx',
  'txt', 'csv',
  'mp3', 'wav',
])
const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
])
const FILE_ACCEPT = [
  '.jpg', '.jpeg', '.png', '.webp',
  '.pdf', '.docx', '.xlsx', '.pptx',
  '.txt', '.csv', '.mp3', '.wav',
].join(',')

function extension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  return match?.[1] ?? ''
}

function publicErrorMessage(status: number, code: string) {
  if (status === 429 || code === 'too_many_requests') return 'Foram feitas muitas tentativas recentemente. Aguarde um pouco antes de enviar outro relato.'
  if (code === 'anonymous_reporting_disabled') return 'O envio anônimo está temporariamente indisponível para esta organização.'
  if (code === 'optional_email_disabled') return 'O recebimento de avisos por e-mail está desativado. Desmarque a opção de e-mail e tente novamente.'
  if (code === 'invalid_category') return 'A categoria selecionada não está mais disponível. Atualize a página e selecione outra categoria.'
  if (code === 'invalid_description') return 'Revise a descrição. Ela precisa ter pelo menos 20 caracteres.'
  if (code === 'gateway_authentication_failed') return 'O canal seguro não conseguiu validar o gateway. Nenhum relato foi registrado.'
  return 'Não foi possível registrar o relato agora. Nenhum protocolo foi gerado. Tente novamente em alguns instantes.'
}

function attachmentError(file: File): string | null {
  const ext = extension(file.name)
  const mime = file.type.trim().toLowerCase()
  const extensionAllowed = ACCEPTED_EXTENSIONS.has(ext)
  const mimeAllowed = !mime || mime === 'application/octet-stream' || ACCEPTED_MIME_TYPES.has(mime)

  if (!extensionAllowed || !mimeAllowed) {
    return `${file.name}: formato não permitido. Use imagens, PDF, DOCX, XLSX, PPTX, TXT, CSV, MP3 ou WAV.`
  }
  if (file.size < 1) return `${file.name}: o arquivo está vazio.`
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name}: o limite é 3 MB por arquivo.`
  return null
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function ReportPageV2() {
  const [step, setStep] = useState(1)
  const [protocol, setProtocol] = useState<string | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [relationship, setRelationship] = useState('')
  const [occurredOn, setOccurredOn] = useState('')
  const [location, setLocation] = useState('')
  const [peopleInvolved, setPeopleInvolved] = useState('')
  const [ongoing, setOngoing] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [notificationEmail, setNotificationEmail] = useState('')
  const [goodFaith, setGoodFaith] = useState(false)
  const [website, setWebsite] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [attachmentState, setAttachmentState] = useState<AttachmentState>('idle')
  const [attachmentResults, setAttachmentResults] = useState<AttachmentResult[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const progress = useMemo(() => `${(step / 4) * 100}%`, [step])

  useEffect(() => {
    let active = true
    void fetch('/api/public/config', { method: 'GET', headers: { accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { config?: PublicConfig }
        if (!response.ok || !body.config) throw new Error('public_config_unavailable')
        if (active) setConfig(body.config)
      })
      .catch(() => {
        if (active) setError('A configuração segura do canal não pôde ser carregada. O envio permanece bloqueado para evitar um registro incompleto.')
      })
      .finally(() => {
        if (active) setConfigLoading(false)
      })
    return () => { active = false }
  }, [])

  function chooseAttachments(files: FileList | null) {
    setError('')
    if (!files) return
    const selected = Array.from(files)
    if (selected.length > MAX_ATTACHMENTS) {
      setError(`Selecione no máximo ${MAX_ATTACHMENTS} arquivos.`)
      return
    }
    for (const file of selected) {
      const validation = attachmentError(file)
      if (validation) {
        setError(validation)
        return
      }
    }
    setAttachments(selected)
  }

  async function uploadAttachments(token: string, files: File[]) {
    setAttachmentState('uploading')
    const results: AttachmentResult[] = []

    for (const file of files) {
      try {
        const response = await fetch('/api/public/attachment', {
          method: 'POST',
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-attachment-token': token,
            'x-file-name': encodeURIComponent(file.name),
          },
          body: file,
        })
        results.push({ name: file.name, ok: response.ok })
      } catch {
        results.push({ name: file.name, ok: false })
      }
      setAttachmentResults([...results])
    }

    setAttachmentState('done')
  }

  function goNext() {
    setError('')
    if (step === 1 && !categoryId) {
      setError('Selecione o assunto principal do relato.')
      return
    }
    if (step === 2 && description.trim().length < 20) {
      setError('Descreva a situação com pelo menos 20 caracteres.')
      return
    }
    setStep((current) => Math.min(4, current + 1))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (step < 4) {
      goNext()
      return
    }
    if (!goodFaith) {
      setError('Confirme que o relato está sendo enviado de boa-fé.')
      return
    }
    if (!config || !config.allowAnonymous || submitting) {
      setError('O canal público seguro ainda não está disponível para envio.')
      return
    }
    if (emailEnabled && !notificationEmail.trim()) {
      setError('Informe o e-mail para avisos ou desmarque a opção de notificações por e-mail.')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/public/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationSlug: config.organizationSlug,
          categoryId,
          relationship: relationship || undefined,
          location: location || undefined,
          occurredOn: occurredOn || undefined,
          ongoing,
          description: description.trim(),
          peopleInvolved: peopleInvolved || undefined,
          notificationEmail: emailEnabled ? notificationEmail.trim().toLowerCase() : undefined,
          goodFaith,
          _website: website,
        }),
      })

      const body = await response.json().catch(() => ({})) as { protocol?: unknown; attachmentToken?: unknown; error?: unknown }
      if (!response.ok || typeof body.protocol !== 'string') {
        setError(publicErrorMessage(response.status, typeof body.error === 'string' ? body.error : ''))
        return
      }

      setProtocol(body.protocol)
      if (attachments.length > 0) {
        if (typeof body.attachmentToken === 'string') {
          void uploadAttachments(body.attachmentToken, attachments)
        } else {
          setAttachmentResults(attachments.map((file) => ({ name: file.name, ok: false })))
          setAttachmentState('done')
        }
      }
    } catch {
      setError('Não foi possível alcançar o canal seguro. Nenhum relato foi registrado.')
    } finally {
      setSubmitting(false)
    }
  }

  if (protocol) {
    const uploaded = attachmentResults.filter((item) => item.ok).length
    const failed = attachmentResults.filter((item) => !item.ok).length
    return (
      <section className="narrow-page section-shell success-page">
        <div className="success-icon"><Check size={30} /></div>
        <span className="eyebrow">Relato recebido</span>
        <h1>Guarde seu protocolo em local seguro.</h1>
        <p>Ele é a chave para acompanhar atualizações e responder à equipe sem criar uma conta.</p>
        <div className="protocol-card"><small>Seu protocolo</small><strong>{protocol}</strong></div>

        {attachments.length > 0 && (
          <div className="attachment-submit-status" role="status" aria-live="polite">
            {attachmentState === 'uploading'
              ? <><LoaderCircle className="spin" size={18} /><div><strong>Processando anexos</strong><span>{attachmentResults.length} de {attachments.length} processados. O relato já está salvo.</span></div></>
              : attachmentState === 'done'
                ? <><Paperclip size={18} /><div><strong>{failed === 0 ? 'Anexos incluídos com segurança' : 'Relato salvo; alguns anexos foram rejeitados'}</strong><span>{uploaded} de {attachments.length} anexos passaram pela validação e foram vinculados ao relato{failed > 0 ? `. ${failed} não foram disponibilizados à equipe.` : '.'}</span></div></>
                : null}
          </div>
        )}

        <div className="hero-actions centered">
          <button className="button primary" type="button" onClick={() => navigator.clipboard?.writeText(protocol)}>Copiar protocolo</button>
          <a className="button secondary" href="#/acompanhar">Acompanhar agora</a>
        </div>
        <div className="privacy-note"><LockKeyhole size={18} /><p>O protocolo não é armazenado em texto puro. O portal mantém apenas um digest HMAC para localizar o relato.</p></div>
      </section>
    )
  }

  return (
    <section className="form-page section-shell">
      <div className="page-heading">
        <span className="eyebrow"><ShieldCheck size={16} /> Novo relato</span>
        <h1>Conte o que aconteceu.</h1>
        <p>Você não precisa se identificar. Inclua apenas as informações necessárias para entender e verificar o fato.</p>
      </div>

      {error && <div className="warning-note" role="alert"><AlertTriangle size={18} /><p>{error}</p></div>}

      <div className="form-layout">
        <form className="report-form" onSubmit={(event) => void submit(event)}>
          <input aria-hidden="true" autoComplete="off" name="website" onChange={(event) => setWebsite(event.target.value)} style={{ position: 'absolute', left: '-10000px', width: 1, height: 1 }} tabIndex={-1} value={website} />
          <div className="form-progress" aria-label={`Etapa ${step} de 4`}><span style={{ width: progress }} /></div>
          <div className="step-meta"><span>Etapa {step} de 4</span><strong>{['Classificação', 'Relato', 'Evidências', 'Acompanhamento'][step - 1]}</strong></div>

          {step === 1 && (
            <fieldset>
              <legend>Qual é o assunto principal?</legend>
              <p className="field-help">Escolha a opção mais próxima. A classificação pode ser ajustada pela triagem depois.</p>
              {configLoading
                ? <div className="settings-loading"><LoaderCircle className="spin" size={20} /> Carregando categorias</div>
                : <div className="choice-grid">
                    {(config?.categories ?? []).map((item) => (
                      <label className={`choice-card ${categoryId === item.id ? 'selected' : ''}`} key={item.id} title={item.description ?? undefined}>
                        <input type="radio" name="category" value={item.id} checked={categoryId === item.id} onChange={() => setCategoryId(item.id)} />
                        <span>{item.name}</span>{categoryId === item.id && <Check size={17} />}
                      </label>
                    ))}
                  </div>}
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend>Descreva a situação</legend>
              <label className="field"><span>O que aconteceu? *</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={20} maxLength={20000} required rows={8} placeholder="Descreva fatos, contexto, datas aproximadas e outras informações relevantes." /><small>{description.length}/20000 caracteres • mínimo de 20</small></label>
              <div className="two-columns">
                <label className="field"><span>Quando aconteceu?</span><input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
                <label className="field"><span>Onde aconteceu?</span><input maxLength={300} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Unidade, setor ou contexto" /></label>
                <label className="field"><span>Sua relação com a organização</span><select value={relationship} onChange={(event) => setRelationship(event.target.value)}><option value="">Prefiro não informar</option><option value="Colaborador">Colaborador</option><option value="Ex-colaborador">Ex-colaborador</option><option value="Fornecedor ou prestador">Fornecedor ou prestador</option><option value="Cliente">Cliente</option><option value="Outro">Outro</option></select></label>
                <label className="check-card"><input type="checkbox" checked={ongoing} onChange={(event) => setOngoing(event.target.checked)} /><div><strong>A situação ainda está acontecendo</strong><span>Marque somente se a conduta continua ocorrendo.</span></div></label>
              </div>
              <label className="field"><span>Pessoas ou áreas envolvidas</span><textarea maxLength={8000} rows={3} value={peopleInvolved} onChange={(event) => setPeopleInvolved(event.target.value)} placeholder="Opcional. Informe apenas se necessário." /></label>
            </fieldset>
          )}

          {step === 3 && (
            <fieldset>
              <legend>Há evidências ou documentos?</legend>
              {config?.allowAttachments
                ? <>
                    <p className="field-help">São aceitos JPEG, PNG, WebP, PDF, DOCX, XLSX, PPTX, TXT, CSV, MP3 e WAV. Limite de 3 MB por arquivo e no máximo 5 anexos.</p>
                    <label className="upload-zone"><FileArchive size={25} /><strong>Adicionar arquivos</strong><span>Imagens, documentos e áudio • até 3 MB cada • máximo de 5</span><input accept={FILE_ACCEPT} type="file" multiple onChange={(event) => chooseAttachments(event.target.files)} /></label>
                    {attachments.length > 0 && <div className="selected-attachments">{attachments.map((file, index) => <div className="selected-attachment" key={`${file.name}-${file.size}-${index}`}><div><strong>{file.name}</strong><small>{formatSize(file.size)}</small></div><button aria-label={`Remover ${file.name}`} title="Remover" type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button></div>)}</div>}
                    <div className="privacy-note"><ShieldCheck size={18} /><p>O original permanece em quarentena privada. A equipe recebe somente a cópia sanitizada ou normalizada que passou pela validação estrutural do formato.</p></div>
                  </>
                : <>
                    <p className="field-help">Anexos estão temporariamente desativados para este canal.</p>
                    <label className="upload-zone"><Paperclip size={24} /><strong>Adicionar arquivos</strong><span>Indisponível neste momento.</span><input disabled type="file" /></label>
                  </>}
            </fieldset>
          )}

          {step === 4 && (
            <fieldset>
              <legend>Como você quer acompanhar?</legend>
              <p className="field-help">O protocolo continuará sendo a forma principal de acompanhamento. O e-mail é opcional e recebe apenas avisos neutros.</p>

              {config?.allowOptionalEmail && <label className="check-card"><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} /><div><strong>Quero receber avisos por e-mail</strong><span>O conteúdo do relato, protocolo e mensagens não são enviados no e-mail.</span></div></label>}
              {emailEnabled && <label className="field"><span>E-mail para avisos</span><input type="email" autoComplete="email" maxLength={320} value={notificationEmail} onChange={(event) => setNotificationEmail(event.target.value)} placeholder="seu-email@exemplo.com" /></label>}

              <label className="check-card"><input type="checkbox" checked={goodFaith} onChange={(event) => setGoodFaith(event.target.checked)} /><div><strong>Confirmo que envio este relato de boa-fé *</strong><span>Forneci as informações que considero verdadeiras e relevantes para a análise.</span></div></label>
            </fieldset>
          )}

          <div className="form-actions">
            {step > 1 ? <button className="button secondary" type="button" onClick={() => { setError(''); setStep((current) => Math.max(1, current - 1)) }}><ChevronLeft size={17} /> Voltar</button> : <span />}
            {step < 4
              ? <button className="button primary" type="button" onClick={goNext}>Continuar <ChevronRight size={17} /></button>
              : <button className="button primary" disabled={submitting || configLoading} type="submit">{submitting ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} Enviar relato</button>}
          </div>
        </form>

        <aside className="form-aside">
          <div className="aside-card"><LockKeyhole size={18} /><div><strong>Sem identificação obrigatória</strong><p>Evite inserir dados pessoais que não sejam necessários para compreender o fato.</p></div></div>
          <div className="aside-card"><ShieldCheck size={18} /><div><strong>Anexos em quarentena</strong><p>Arquivos originais não são disponibilizados diretamente à equipe interna.</p></div></div>
          <div className="aside-card"><Paperclip size={18} /><div><strong>Validação por formato</strong><p>Arquivos com recursos ativos, estrutura inválida ou formato incompatível são rejeitados.</p></div></div>
        </aside>
      </div>
    </section>
  )
}
