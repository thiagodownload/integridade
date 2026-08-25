import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, LoaderCircle, Plus, Save, Shield, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Feedback = { type: 'success' | 'error'; text: string } | null
type StaffRole = 'platform_admin' | 'compliance_manager' | 'investigator' | 'auditor' | 'privacy_officer'
type NotificationChannel = 'in_app' | 'email' | 'browser'
type NotificationEvent = 'report.created' | 'report.restricted.created' | 'sla.warning_70' | 'sla.warning_90' | 'sla.expired' | 'report.message.created'

type NotificationRule = {
  localKey: string
  id: string | null
  event_type: NotificationEvent
  channel: NotificationChannel
  destination_role: StaffRole
  enabled: boolean
}

const eventOptions: Array<{ value: NotificationEvent; label: string }> = [
  { value: 'report.created', label: 'Novo relato recebido' },
  { value: 'report.restricted.created', label: 'Novo relato restrito' },
  { value: 'sla.warning_70', label: 'SLA atingiu 70%' },
  { value: 'sla.warning_90', label: 'SLA atingiu 90%' },
  { value: 'sla.expired', label: 'SLA vencido' },
  { value: 'report.message.created', label: 'Nova mensagem do denunciante' },
]

const channelOptions: Array<{ value: NotificationChannel; label: string }> = [
  { value: 'in_app', label: 'Painel interno' },
  { value: 'email', label: 'E-mail' },
  { value: 'browser', label: 'Navegador' },
]

const roleOptions: Array<{ value: StaffRole; label: string }> = [
  { value: 'platform_admin', label: 'Administrador da plataforma' },
  { value: 'compliance_manager', label: 'Gestor de Compliance' },
  { value: 'investigator', label: 'Investigador' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'privacy_officer', label: 'Privacy Officer' },
]

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null
  return <div className={`admin-feedback ${feedback.type}`} role="status">{feedback.type === 'success' && <CheckCircle2 size={18} />}<span>{feedback.text}</span></div>
}

export function NotificationSettingsPanel() {
  const [rules, setRules] = useState<NotificationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const load = useCallback(async () => {
    if (!supabase) return setLoading(false)
    setLoading(true)
    const { data, error } = await supabase.from('notification_rules').select('id,event_type,channel,destination_role,enabled').order('event_type')
    if (error) {
      setFeedback({ type: 'error', text: 'Não foi possível carregar as regras de notificação.' })
      setLoading(false)
      return
    }
    setRules((data ?? []).map((row) => ({
      localKey: String(row.id),
      id: String(row.id),
      event_type: String(row.event_type) as NotificationEvent,
      channel: String(row.channel) as NotificationChannel,
      destination_role: String(row.destination_role) as StaffRole,
      enabled: Boolean(row.enabled),
    })))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const hasDuplicate = useMemo(() => {
    const keys = rules.map((rule) => `${rule.event_type}|${rule.channel}|${rule.destination_role}`)
    return new Set(keys).size !== keys.length
  }, [rules])

  function patch(localKey: string, change: Partial<NotificationRule>) {
    setRules((current) => current.map((rule) => rule.localKey === localKey ? { ...rule, ...change } : rule))
  }

  function addRule() {
    setRules((current) => [...current, {
      localKey: window.crypto.randomUUID(),
      id: null,
      event_type: 'report.created',
      channel: 'in_app',
      destination_role: 'compliance_manager',
      enabled: true,
    }])
  }

  async function save() {
    if (!supabase || hasDuplicate) {
      if (hasDuplicate) setFeedback({ type: 'error', text: 'Há regras duplicadas para o mesmo evento, canal e papel.' })
      return
    }
    setSaving(true)
    setFeedback(null)
    const { error } = await supabase.rpc('admin_save_notification_rules', {
      p_rules: rules.map(({ event_type, channel, destination_role, enabled }) => ({ event_type, channel, destination_role, enabled })),
    })
    if (error) setFeedback({ type: 'error', text: error.message || 'Não foi possível salvar as regras.' })
    else {
      await load()
      setFeedback({ type: 'success', text: 'Regras de notificação salvas e auditadas.' })
    }
    setSaving(false)
  }

  if (loading) return <div className="settings-loading"><LoaderCircle className="spin" size={24} /><strong>Carregando notificações</strong></div>

  return <>
    <div className="settings-heading settings-heading-actions">
      <div><h2>Notificações e escalonamento</h2><p>Configure quais eventos devem gerar avisos, por qual canal e para qual papel interno. A entrega efetiva só ocorrerá quando o worker correspondente estiver habilitado.</p></div>
      <button className="button secondary compact" onClick={addRule} type="button"><Plus size={16} /> Nova regra</button>
    </div>
    <FeedbackBanner feedback={feedback} />
    {rules.length === 0 && <div className="security-callout"><Shield size={19} /><p>Nenhuma regra está ativa. Isso é intencional: o sistema não inventa destinatários nem começa a enviar alertas por conta própria.</p></div>}
    <div className="sla-editor-grid">
      {rules.map((rule) => <article className="sla-editor" key={rule.localKey}>
        <div className="three-columns">
          <label className="field"><span>Evento</span><select value={rule.event_type} onChange={(event) => patch(rule.localKey, { event_type: event.target.value as NotificationEvent })}>{eventOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="field"><span>Canal</span><select value={rule.channel} onChange={(event) => patch(rule.localKey, { channel: event.target.value as NotificationChannel })}>{channelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="field"><span>Destino</span><select value={rule.destination_role} onChange={(event) => patch(rule.localKey, { destination_role: event.target.value as StaffRole })}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
        <div className="setting-row">
          <div><strong>Regra ativa</strong><span>Desative sem apagar a configuração.</span></div>
          <div className="admin-access-actions"><label className="switch"><input type="checkbox" checked={rule.enabled} onChange={(event) => patch(rule.localKey, { enabled: event.target.checked })} /><span /></label><button className="button secondary compact" onClick={() => setRules((current) => current.filter((item) => item.localKey !== rule.localKey))} type="button"><Trash2 size={15} /> Remover</button></div>
        </div>
      </article>)}
    </div>
    <div className="admin-access-actions"><button className="button primary" disabled={saving || hasDuplicate} onClick={save} type="button">{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {saving ? 'Salvando...' : 'Salvar notificações'}</button></div>
  </>
}

type EmailState = { sender_name: string; sender_email: string; reply_to_email: string; subject_prefix: string }

export function EmailSettingsPanel() {
  const [value, setValue] = useState<EmailState>({ sender_name: 'Canal de Integridade', sender_email: '', reply_to_email: '', subject_prefix: '[Canal de Integridade]' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  useEffect(() => {
    if (!supabase) return setLoading(false)
    void supabase.from('email_settings').select('sender_name,sender_email,reply_to_email,subject_prefix').maybeSingle().then(({ data, error }) => {
      if (error || !data) setFeedback({ type: 'error', text: 'Não foi possível carregar a configuração de e-mail.' })
      else setValue({ sender_name: String(data.sender_name ?? ''), sender_email: String(data.sender_email ?? ''), reply_to_email: String(data.reply_to_email ?? ''), subject_prefix: String(data.subject_prefix ?? '') })
      setLoading(false)
    })
  }, [])

  async function save() {
    if (!supabase) return
    setSaving(true)
    setFeedback(null)
    const { error } = await supabase.rpc('admin_update_email_settings', {
      p_sender_name: value.sender_name,
      p_sender_email: value.sender_email,
      p_reply_to_email: value.reply_to_email,
      p_subject_prefix: value.subject_prefix,
    })
    setSaving(false)
    setFeedback(error ? { type: 'error', text: error.message || 'Não foi possível salvar a configuração de e-mail.' } : { type: 'success', text: 'Identidade de e-mail salva e auditada.' })
  }

  if (loading) return <div className="settings-loading"><LoaderCircle className="spin" size={24} /><strong>Carregando e-mail</strong></div>

  return <>
    <div className="settings-heading"><h2>Identidade de e-mail</h2><p>Esta aba armazena somente dados públicos do remetente. API keys, senhas SMTP e tokens continuam fora do navegador e do banco exposto.</p></div>
    <FeedbackBanner feedback={feedback} />
    <div className="two-columns">
      <label className="field"><span>Remetente exibido</span><input maxLength={120} value={value.sender_name} onChange={(event) => setValue({ ...value, sender_name: event.target.value })} /></label>
      <label className="field"><span>E-mail do remetente</span><input maxLength={320} type="email" placeholder="integridade@empresa.com.br" value={value.sender_email} onChange={(event) => setValue({ ...value, sender_email: event.target.value })} /></label>
      <label className="field"><span>Reply-to</span><input maxLength={320} type="email" placeholder="Opcional" value={value.reply_to_email} onChange={(event) => setValue({ ...value, reply_to_email: event.target.value })} /></label>
      <label className="field"><span>Prefixo do assunto</span><input maxLength={80} value={value.subject_prefix} onChange={(event) => setValue({ ...value, subject_prefix: event.target.value })} /></label>
    </div>
    <div className="security-callout"><Shield size={19} /><p>O mecanismo de entrega permanece desativado até existir um provedor configurado com secret no backend. Preencher um endereço aqui não habilita envio sozinho.</p></div>
    <button className="button primary" disabled={saving} onClick={save} type="button">{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {saving ? 'Salvando...' : 'Salvar e-mail'}</button>
  </>
}

type PrivacyState = {
  report_retention_days: string
  audit_retention_days: string
  attachment_retention_days: string
  anonymize_closed_after_days: string
  retention_policy_version: string
  legal_review_reference: string
}

function optionalInteger(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN
}

export function PrivacySettingsPanel() {
  const [value, setValue] = useState<PrivacyState>({ report_retention_days: '', audit_retention_days: '', attachment_retention_days: '', anonymize_closed_after_days: '', retention_policy_version: '', legal_review_reference: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  useEffect(() => {
    if (!supabase) return setLoading(false)
    void supabase.from('privacy_settings').select('report_retention_days,audit_retention_days,attachment_retention_days,anonymize_closed_after_days,retention_policy_version,legal_review_reference').maybeSingle().then(({ data, error }) => {
      if (error || !data) setFeedback({ type: 'error', text: 'Não foi possível carregar a política de privacidade.' })
      else setValue({
        report_retention_days: data.report_retention_days == null ? '' : String(data.report_retention_days),
        audit_retention_days: data.audit_retention_days == null ? '' : String(data.audit_retention_days),
        attachment_retention_days: data.attachment_retention_days == null ? '' : String(data.attachment_retention_days),
        anonymize_closed_after_days: data.anonymize_closed_after_days == null ? '' : String(data.anonymize_closed_after_days),
        retention_policy_version: String(data.retention_policy_version ?? ''),
        legal_review_reference: String(data.legal_review_reference ?? ''),
      })
      setLoading(false)
    })
  }, [])

  async function save() {
    if (!supabase) return
    const numbers = [value.report_retention_days, value.audit_retention_days, value.attachment_retention_days, value.anonymize_closed_after_days].map(optionalInteger)
    if (numbers.some((number) => Number.isNaN(number))) {
      setFeedback({ type: 'error', text: 'Prazos devem ser números inteiros positivos ou ficar em branco.' })
      return
    }
    setSaving(true)
    setFeedback(null)
    const { error } = await supabase.rpc('admin_update_privacy_settings', {
      p_report_retention_days: numbers[0],
      p_audit_retention_days: numbers[1],
      p_attachment_retention_days: numbers[2],
      p_anonymize_closed_after_days: numbers[3],
      p_retention_policy_version: value.retention_policy_version,
      p_legal_review_reference: value.legal_review_reference,
    })
    setSaving(false)
    setFeedback(error ? { type: 'error', text: error.message || 'Não foi possível salvar a política de privacidade.' } : { type: 'success', text: 'Parâmetros de privacidade salvos e auditados.' })
  }

  if (loading) return <div className="settings-loading"><LoaderCircle className="spin" size={24} /><strong>Carregando privacidade</strong></div>

  return <>
    <div className="settings-heading"><h2>Privacidade e retenção</h2><p>Os campos são reais, mas permanecem em branco até existir uma decisão aprovada. O sistema não inventa prazo de retenção em nome do Jurídico ou DPO.</p></div>
    <FeedbackBanner feedback={feedback} />
    <div className="two-columns">
      <label className="field"><span>Retenção de relatos</span><input min="1" type="number" placeholder="Não definido" value={value.report_retention_days} onChange={(event) => setValue({ ...value, report_retention_days: event.target.value })} /><small>dias</small></label>
      <label className="field"><span>Retenção de auditoria</span><input min="1" type="number" placeholder="Não definido" value={value.audit_retention_days} onChange={(event) => setValue({ ...value, audit_retention_days: event.target.value })} /><small>dias</small></label>
      <label className="field"><span>Retenção de anexos</span><input min="1" type="number" placeholder="Não definido" value={value.attachment_retention_days} onChange={(event) => setValue({ ...value, attachment_retention_days: event.target.value })} /><small>dias</small></label>
      <label className="field"><span>Anonimizar após encerramento</span><input min="1" type="number" placeholder="Não definido" value={value.anonymize_closed_after_days} onChange={(event) => setValue({ ...value, anonymize_closed_after_days: event.target.value })} /><small>dias após encerramento</small></label>
      <label className="field"><span>Versão da política de retenção</span><input maxLength={50} placeholder="Ex.: 2026-01" value={value.retention_policy_version} onChange={(event) => setValue({ ...value, retention_policy_version: event.target.value })} /></label>
      <label className="field"><span>Referência de revisão jurídica/DPO</span><input maxLength={240} placeholder="Documento, parecer ou ata" value={value.legal_review_reference} onChange={(event) => setValue({ ...value, legal_review_reference: event.target.value })} /></label>
    </div>
    <div className="security-callout"><Shield size={19} /><p>Deixar um prazo em branco significa “não definido”, não exclusão automática. A futura rotina de retenção só poderá ser habilitada depois que esses parâmetros forem formalmente aprovados.</p></div>
    <button className="button primary" disabled={saving} onClick={save} type="button">{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {saving ? 'Salvando...' : 'Salvar privacidade'}</button>
  </>
}
