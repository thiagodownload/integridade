import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, LoaderCircle, LockKeyhole, Paperclip, ShieldCheck } from 'lucide-react'

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

function publicErrorMessage(status: number, code: string) {
  if (status === 429 || code === 'too_many_requests') return 'Foram feitas muitas tentativas recentemente. Aguarde um pouco antes de enviar outro relato.'
  if (code === 'anonymous_reporting_disabled') return 'O envio anônimo está temporariamente indisponível para esta organização.'
  if (code === 'optional_email_disabled') return 'O recebimento de avisos por e-mail está desativado. Desmarque a opção de e-mail e tente novamente.'
  if (code === 'invalid_category') return 'A categoria selecionada não está mais disponível. Atualize a página e selecione outra categoria.'
  if (code === 'invalid_description') return 'Revise a descrição. Ela precisa ter pelo menos 20 caracteres.'
  if (code === 'gateway_authentication_failed') return 'O canal seguro não conseguiu validar o gateway. Nenhum relato foi registrado.'
  return 'Não foi possível registrar o relato agora. Nenhum protocolo foi gerado. Tente novamente em alguns instantes.'
}

export function ReportPage() {
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (step === 1 && !categoryId) return
    if (step === 2 && description.trim().length < 20) return
    if (step === 4 && !goodFaith) return

    if (step < 4) {
      setStep((value) => value + 1)
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

      const body = await response.json().catch(() => ({})) as { protocol?: unknown; error?: unknown }
      if (!response.ok || typeof body.protocol !== 'string') {
        setError(publicErrorMessage(response.status, typeof body.error === 'string' ? body.error : ''))
        return
      }

      setProtocol(body.protocol)
    } catch {
      setError('Não foi possível alcançar o canal seguro. Nenhum relato foi registrado.')
    } finally {
      setSubmitting(false)
    }
  }

  if (protocol) {
    return (
      <section className="narrow-page section-shell success-page">
        <div className="success-icon"><Check size={30} /></div>
        <span className="eyebrow">Relato recebido</span>
        <h1>Guarde seu protocolo em local seguro.</h1>
        <p>Ele é a chave para acompanhar atualizações e responder à equipe sem criar uma conta.</p>
        <div className="protocol-card"><small>Seu protocolo</small><strong>{protocol}</strong></div>
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
              <p className="field-help">Anexos permanecem desativados até a implantação da quarentena e verificação segura dos arquivos.</p>
              <label className="upload-zone"><Paperclip size={24} /><strong>Adicionar arquivos</strong><span>Indisponível nesta fase de validação.</span><input type="file" multiple disabled /></label>
              <div className="warning-note"><AlertTriangle size={18} /><p>Não envie documentos por outro canal para contornar esta limitação. O fluxo de anexos será liberado somente com tratamento de metadados e verificação de segurança.</p></div>
            </fieldset>
          )}

          {step === 4 && (
            <fieldset>
              <legend>Como você quer acompanhar?</legend>
              {config?.allowOptionalEmail
                ? <>
                    <label className="check-card"><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} /><div><strong>Quero receber avisos por e-mail</strong><span>Opcional. O endereço fica criptografado e separado do conteúdo do caso.</span></div></label>
                    {emailEnabled && <label className="field"><span>E-mail para avisos</span><input type="email" autoComplete="email" maxLength={320} value={notificationEmail} onChange={(event) => setNotificationEmail(event.target.value)} placeholder="seu@email.com" required /></label>}
                  </>
                : <p className="field-help">Notificações por e-mail não estão habilitadas. Guarde o protocolo para acompanhar o relato.</p>}
              <label className="check-card required"><input type="checkbox" checked={goodFaith} onChange={(event) => setGoodFaith(event.target.checked)} required /><div><strong>Confirmo que envio este relato de boa-fé *</strong><span>Isso significa relatar honestamente o que você acredita ter ocorrido, mesmo sem possuir todas as provas.</span></div></label>
            </fieldset>
          )}

          <div className="form-actions">
            {step > 1 ? <button className="button secondary" disabled={submitting} type="button" onClick={() => setStep((value) => value - 1)}><ChevronLeft size={18} /> Voltar</button> : <a className="button secondary" href="#/">Cancelar</a>}
            <button className="button primary" disabled={submitting || configLoading || !config} type="submit">{submitting ? <><LoaderCircle className="spin" size={17} /> Enviando...</> : <>{step === 4 ? 'Enviar relato' : 'Continuar'} {step < 4 && <ChevronRight size={18} />}</>}</button>
          </div>
        </form>

        <aside className="form-aside">
          <div className="aside-card"><ShieldCheck size={20} /><div><strong>Identificação não é obrigatória</strong><p>Nome, CPF, matrícula e login não fazem parte do fluxo público.</p></div></div>
          <div className="aside-card"><LockKeyhole size={20} /><div><strong>O protocolo é sua chave</strong><p>Quem possuir o protocolo poderá acompanhar o caso. Guarde-o com cuidado.</p></div></div>
        </aside>
      </div>
    </section>
  )
}
