import { useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, MailCheck, Save, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Feedback = { type: 'success' | 'error'; text: string } | null

type EmailState = {
  senderName: string
  senderEmail: string
  replyToEmail: string
  subjectPrefix: string
  transportEnabled: boolean
  smtpHost: string
  smtpPort: string
  smtpSecure: boolean
  smtpRequireTls: boolean
  smtpUsername: string
  smtpPassword: string
  passwordConfigured: boolean
  lastTestAt: string | null
  lastTestOk: boolean | null
}

const initialState: EmailState = {
  senderName: 'Canal de Integridade',
  senderEmail: '',
  replyToEmail: '',
  subjectPrefix: '[Canal de Integridade]',
  transportEnabled: false,
  smtpHost: '',
  smtpPort: '587',
  smtpSecure: false,
  smtpRequireTls: true,
  smtpUsername: '',
  smtpPassword: '',
  passwordConfigured: false,
  lastTestAt: null,
  lastTestOk: null,
}

async function functionErrorCode(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object' || !('context' in error)) return ''
  const context = (error as { context?: unknown }).context
  if (!(context instanceof Response)) return ''
  try {
    const body = await context.clone().json() as { error?: unknown }
    return typeof body.error === 'string' ? body.error : ''
  } catch {
    return ''
  }
}

function errorMessage(code: string, fallback: string) {
  const messages: Record<string, string> = {
    smtp_password_required: 'Informe a senha SMTP antes de habilitar o transporte.',
    smtp_configuration_incomplete: 'Preencha host e usuário SMTP antes de habilitar o transporte.',
    invalid_smtp_port: 'A porta SMTP informada é inválida.',
    invalid_sender_email: 'O e-mail do remetente é inválido.',
    invalid_reply_to: 'O Reply-To informado é inválido.',
    email_transport_not_configured: 'O transporte SMTP ainda não está totalmente configurado.',
    smtp_test_failed: 'O servidor SMTP não respondeu corretamente ao teste. Confira host, porta, TLS, usuário e senha.',
    administrator_email_missing: 'Sua conta administrativa não possui e-mail disponível para receber o teste.',
  }
  return messages[code] ?? fallback
}

function formatDate(value: string | null) {
  if (!value) return 'Nunca testado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export function PortalEmailSettingsPanel() {
  const [value, setValue] = useState<EmailState>(initialState)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function load() {
    if (!supabase) {
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('email_settings')
      .select('sender_name,sender_email,reply_to_email,subject_prefix,transport_enabled,smtp_host,smtp_port,smtp_secure,smtp_require_tls,smtp_username,smtp_password_configured,last_test_at,last_test_ok')
      .maybeSingle()

    if (error || !data) {
      setFeedback({ type: 'error', text: 'Não foi possível carregar a configuração de e-mail.' })
      setLoading(false)
      return
    }

    setValue({
      senderName: String(data.sender_name ?? ''),
      senderEmail: String(data.sender_email ?? ''),
      replyToEmail: String(data.reply_to_email ?? ''),
      subjectPrefix: String(data.subject_prefix ?? ''),
      transportEnabled: Boolean(data.transport_enabled),
      smtpHost: String(data.smtp_host ?? ''),
      smtpPort: String(data.smtp_port ?? 587),
      smtpSecure: Boolean(data.smtp_secure),
      smtpRequireTls: Boolean(data.smtp_require_tls),
      smtpUsername: String(data.smtp_username ?? ''),
      smtpPassword: '',
      passwordConfigured: Boolean(data.smtp_password_configured),
      lastTestAt: data.last_test_at ? String(data.last_test_at) : null,
      lastTestOk: data.last_test_ok == null ? null : Boolean(data.last_test_ok),
    })
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function save() {
    if (!supabase || saving) return
    setSaving(true)
    setFeedback(null)

    const { error } = await supabase.functions.invoke('admin-email-config', {
      body: {
        action: 'save',
        senderName: value.senderName,
        senderEmail: value.senderEmail,
        replyToEmail: value.replyToEmail,
        subjectPrefix: value.subjectPrefix,
        transportEnabled: value.transportEnabled,
        smtpHost: value.smtpHost,
        smtpPort: Number(value.smtpPort),
        smtpSecure: value.smtpSecure,
        smtpRequireTls: value.smtpRequireTls,
        smtpUsername: value.smtpUsername,
        smtpPassword: value.smtpPassword,
      },
    })

    if (error) {
      const code = await functionErrorCode(error)
      setFeedback({ type: 'error', text: errorMessage(code, 'Não foi possível salvar a configuração SMTP.') })
      setSaving(false)
      return
    }

    await load()
    setSaving(false)
    setFeedback({ type: 'success', text: 'Configuração SMTP salva. A senha ficou protegida no Vault e não é devolvida ao navegador.' })
  }

  async function test() {
    if (!supabase || testing) return
    setTesting(true)
    setFeedback(null)

    const { error } = await supabase.functions.invoke('admin-email-config', {
      body: { action: 'test' },
    })

    if (error) {
      const code = await functionErrorCode(error)
      setFeedback({ type: 'error', text: errorMessage(code, 'O teste SMTP falhou.') })
      await load()
      setTesting(false)
      return
    }

    await load()
    setTesting(false)
    setFeedback({ type: 'success', text: 'Teste concluído. O portal enviou uma mensagem para o e-mail da sua conta administrativa.' })
  }

  if (loading) {
    return <div className="settings-loading"><LoaderCircle className="spin" size={24} /><strong>Carregando serviço de e-mail</strong></div>
  }

  return <>
    <div className="settings-heading settings-heading-actions">
      <div>
        <h2>Serviço de e-mail do portal</h2>
        <p>Este SMTP será o transporte padrão do Canal de Integridade para convites, recuperação de acesso e notificações transacionais.</p>
      </div>
      <div className="staff-statuses">
        <span className={`status-pill ${value.transportEnabled ? 'ok' : 'warn'}`}>{value.transportEnabled ? 'Transporte ativo' : 'Transporte desativado'}</span>
        <span className={`status-pill ${value.passwordConfigured ? 'ok' : 'warn'}`}>{value.passwordConfigured ? 'Senha no Vault' : 'Senha pendente'}</span>
        <span className={`status-pill ${value.lastTestOk === true ? 'ok' : value.lastTestOk === false ? 'off' : 'warn'}`}>{value.lastTestOk === true ? 'Último teste OK' : value.lastTestOk === false ? 'Último teste falhou' : 'Não testado'}</span>
      </div>
    </div>

    {feedback && <div className={`admin-feedback ${feedback.type}`} role="status">
      {feedback.type === 'success' && <CheckCircle2 size={18} />}
      <span>{feedback.text}</span>
    </div>}

    <div className="two-columns">
      <label className="field"><span>Nome do remetente</span><input maxLength={120} value={value.senderName} onChange={(event) => setValue({ ...value, senderName: event.target.value })} /></label>
      <label className="field"><span>E-mail do remetente</span><input maxLength={320} type="email" placeholder="integridade@empresa.com.br" value={value.senderEmail} onChange={(event) => setValue({ ...value, senderEmail: event.target.value })} /></label>
      <label className="field"><span>Reply-To</span><input maxLength={320} type="email" placeholder="Opcional" value={value.replyToEmail} onChange={(event) => setValue({ ...value, replyToEmail: event.target.value })} /></label>
      <label className="field"><span>Prefixo do assunto</span><input maxLength={80} value={value.subjectPrefix} onChange={(event) => setValue({ ...value, subjectPrefix: event.target.value })} /></label>
    </div>

    <article className="sla-editor">
      <div className="settings-heading"><h3>Servidor SMTP</h3><p>A senha digitada aqui é enviada ao backend por HTTPS, armazenada no Supabase Vault e nunca é exibida novamente.</p></div>
      <div className="two-columns">
        <label className="field"><span>Host SMTP</span><input maxLength={253} placeholder="smtp.empresa.com.br" value={value.smtpHost} onChange={(event) => setValue({ ...value, smtpHost: event.target.value })} /></label>
        <label className="field"><span>Porta</span><input min="1" max="65535" type="number" value={value.smtpPort} onChange={(event) => setValue({ ...value, smtpPort: event.target.value })} /></label>
        <label className="field"><span>Usuário SMTP</span><input maxLength={320} autoComplete="username" value={value.smtpUsername} onChange={(event) => setValue({ ...value, smtpUsername: event.target.value })} /></label>
        <label className="field"><span>Senha SMTP</span><input type="password" autoComplete="new-password" placeholder={value.passwordConfigured ? 'Deixe em branco para manter a senha atual' : 'Informe a senha SMTP'} value={value.smtpPassword} onChange={(event) => setValue({ ...value, smtpPassword: event.target.value })} /></label>
      </div>

      <div className="setting-row"><div><strong>SSL/TLS direto</strong><span>Normalmente usado na porta 465. Em 587, geralmente fica desativado e o STARTTLS é negociado.</span></div><label className="switch"><input type="checkbox" checked={value.smtpSecure} onChange={(event) => setValue({ ...value, smtpSecure: event.target.checked })} /><span /></label></div>
      <div className="setting-row"><div><strong>Exigir TLS/STARTTLS</strong><span>Recomendado para impedir que credenciais sejam enviadas por conexão sem criptografia.</span></div><label className="switch"><input type="checkbox" checked={value.smtpRequireTls} onChange={(event) => setValue({ ...value, smtpRequireTls: event.target.checked })} /><span /></label></div>
      <div className="setting-row"><div><strong>Usar este SMTP no portal</strong><span>Quando ativo, convites e demais mensagens transacionais usam este transporte.</span></div><label className="switch"><input type="checkbox" checked={value.transportEnabled} onChange={(event) => setValue({ ...value, transportEnabled: event.target.checked })} /><span /></label></div>
    </article>

    <div className="security-callout"><Shield size={19} /><p>Último teste: {formatDate(value.lastTestAt)}. Convites de usuários agora usam este serviço. Os próximos emissores, como recuperação de senha e alertas de relatos/SLA, também usam o mesmo módulo de transporte.</p></div>

    <div className="admin-access-actions">
      <button className="button secondary" disabled={testing || !value.transportEnabled || !value.passwordConfigured} onClick={test} type="button">{testing ? <LoaderCircle className="spin" size={17} /> : <MailCheck size={17} />} {testing ? 'Testando...' : 'Enviar e-mail de teste'}</button>
      <button className="button primary" disabled={saving} onClick={save} type="button">{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {saving ? 'Salvando...' : 'Salvar serviço de e-mail'}</button>
    </div>
  </>
}
