import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Building2, CheckCircle2, Clock3, KeyRound, LoaderCircle, Mail, Plus, Save, Shield, Tags, Users } from 'lucide-react'
import { InternalShell } from '../components/InternalShell'
import { supabase, supabaseConfigured } from '../lib/supabase'

const tabs = [
  ['geral', 'Geral', Building2],
  ['categorias', 'Categorias', Tags],
  ['sla', 'SLA', Clock3],
  ['notificacoes', 'Notificações', Bell],
  ['email', 'E-mail', Mail],
  ['acessos', 'Acessos', Users],
  ['privacidade', 'Privacidade', Shield],
] as const

type TabId = (typeof tabs)[number][0]
type Priority = 'low' | 'medium' | 'high' | 'critical'
type Feedback = { type: 'success' | 'error'; text: string } | null

interface GeneralState {
  organizationName: string
  publicName: string
  welcomeText: string
  allowAnonymous: boolean
  allowOptionalEmail: boolean
  allowAttachments: boolean
  defaultTimezone: string
  privacyNoticeVersion: string
}

interface CategoryState {
  id: string | null
  localKey: string
  name: string
  description: string
  active: boolean
  severity_default: Priority
  restricted_by_default: boolean
}

interface SlaState {
  id: string
  priority: Priority
  first_action_minutes: number
  triage_minutes: number
  update_reporter_minutes: number
  resolution_target_minutes: number | null
  active: boolean
}

const editableTabs = new Set<TabId>(['geral', 'categorias', 'sla'])
const priorityOrder: Priority[] = ['critical', 'high', 'medium', 'low']
const priorityLabels: Record<Priority, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

export function AdminPage() {
  const [tab, setTab] = useState<TabId>('geral')
  const [organizationId, setOrganizationId] = useState('')
  const [general, setGeneral] = useState<GeneralState | null>(null)
  const [categories, setCategories] = useState<CategoryState[]>([])
  const [slaPolicies, setSlaPolicies] = useState<SlaState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const loadSettings = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      return
    }

    setLoading(true)
    const client = supabase
    const [organizationResult, settingsResult, categoriesResult, slaResult] = await Promise.all([
      client.from('organizations').select('id,name').maybeSingle(),
      client.from('site_settings').select('organization_id,public_name,welcome_text,allow_anonymous,allow_optional_email,allow_attachments,default_timezone,privacy_notice_version').maybeSingle(),
      client.from('report_categories').select('id,name,description,active,severity_default,restricted_by_default').order('name'),
      client.from('sla_policies').select('id,priority,first_action_minutes,triage_minutes,update_reporter_minutes,resolution_target_minutes,active,category_id').is('category_id', null),
    ])

    const firstError = organizationResult.error || settingsResult.error || categoriesResult.error || slaResult.error
    if (firstError) {
      setFeedback({ type: 'error', text: 'Não foi possível carregar as configurações administrativas.' })
      setLoading(false)
      return
    }

    const organization = organizationResult.data
    const settings = settingsResult.data
    if (!organization || !settings) {
      setFeedback({ type: 'error', text: 'A organização ou as configurações do canal não foram encontradas.' })
      setLoading(false)
      return
    }

    setOrganizationId(String(organization.id))
    setGeneral({
      organizationName: String(organization.name ?? ''),
      publicName: String(settings.public_name ?? ''),
      welcomeText: String(settings.welcome_text ?? ''),
      allowAnonymous: Boolean(settings.allow_anonymous),
      allowOptionalEmail: Boolean(settings.allow_optional_email),
      allowAttachments: Boolean(settings.allow_attachments),
      defaultTimezone: String(settings.default_timezone ?? 'America/Sao_Paulo'),
      privacyNoticeVersion: String(settings.privacy_notice_version ?? ''),
    })

    setCategories((categoriesResult.data ?? []).map((row) => ({
      id: String(row.id),
      localKey: String(row.id),
      name: String(row.name ?? ''),
      description: String(row.description ?? ''),
      active: Boolean(row.active),
      severity_default: String(row.severity_default) as Priority,
      restricted_by_default: Boolean(row.restricted_by_default),
    })))

    setSlaPolicies((slaResult.data ?? [])
      .map((row) => ({
        id: String(row.id),
        priority: String(row.priority) as Priority,
        first_action_minutes: Number(row.first_action_minutes),
        triage_minutes: Number(row.triage_minutes),
        update_reporter_minutes: Number(row.update_reporter_minutes),
        resolution_target_minutes: row.resolution_target_minutes == null ? null : Number(row.resolution_target_minutes),
        active: Boolean(row.active),
      }))
      .sort((a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority)))

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    setFeedback(null)
  }, [tab])

  const canSave = useMemo(() => editableTabs.has(tab) && !loading && !saving, [tab, loading, saving])

  async function saveCurrentTab() {
    if (!supabase || !canSave) return
    setSaving(true)
    setFeedback(null)

    try {
      if (tab === 'geral') {
        if (!general) throw new Error('Configurações gerais indisponíveis')
        const { error } = await supabase.rpc('admin_update_general_settings', {
          p_organization_name: general.organizationName,
          p_public_name: general.publicName,
          p_welcome_text: general.welcomeText,
          p_allow_anonymous: general.allowAnonymous,
          p_allow_optional_email: general.allowOptionalEmail,
          p_allow_attachments: general.allowAttachments,
          p_default_timezone: general.defaultTimezone,
          p_privacy_notice_version: general.privacyNoticeVersion,
        })
        if (error) throw error
      }

      if (tab === 'categorias') {
        if (!organizationId) throw new Error('Organização indisponível')
        if (categories.some((category) => category.name.trim().length < 2)) {
          throw new Error('Toda categoria precisa ter um nome com pelo menos 2 caracteres.')
        }
        const { error } = await supabase.rpc('admin_save_categories', {
          p_categories: categories.map((category) => ({
            id: category.id,
            name: category.name,
            description: category.description,
            active: category.active,
            severity_default: category.severity_default,
            restricted_by_default: category.restricted_by_default,
          })),
        })
        if (error) throw error
      }

      if (tab === 'sla') {
        const { error } = await supabase.rpc('admin_save_sla', {
          p_policies: slaPolicies.map((policy) => ({
            id: policy.id,
            first_action_minutes: policy.first_action_minutes,
            triage_minutes: policy.triage_minutes,
            update_reporter_minutes: policy.update_reporter_minutes,
            resolution_target_minutes: policy.resolution_target_minutes,
            active: policy.active,
          })),
        })
        if (error) throw error
      }

      await loadSettings()
      setFeedback({ type: 'success', text: 'Alterações salvas no Supabase e registradas na auditoria.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar as alterações.'
      setFeedback({ type: 'error', text: message })
    } finally {
      setSaving(false)
    }
  }

  function addCategory() {
    setCategories((current) => [
      ...current,
      {
        id: null,
        localKey: window.crypto.randomUUID(),
        name: 'Nova categoria',
        description: '',
        active: true,
        severity_default: 'medium',
        restricted_by_default: false,
      },
    ])
  }

  return (
    <InternalShell active="admin">
      <div className="internal-header">
        <div><span className="eyebrow">Administração</span><h1>Regras e configurações</h1><p>Configuração do canal sem conceder acesso automático ao conteúdo das denúncias.</p></div>
        {editableTabs.has(tab)
          ? <button className="button primary" disabled={!canSave} onClick={saveCurrentTab} type="button">{saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />} {saving ? 'Salvando...' : 'Salvar alterações'}</button>
          : <span className="admin-module-badge">Próximo módulo</span>}
      </div>

      <div className={`connection-banner ${supabaseConfigured ? 'connected' : ''}`}>
        <span className="connection-dot" /><div><strong>{supabaseConfigured ? 'Supabase conectado • MFA/AAL2 obrigatório' : 'Supabase ainda não conectado neste ambiente'}</strong><p>{supabaseConfigured ? 'Geral, Categorias e SLA já usam dados reais. Alterações são auditadas no banco.' : 'Preencha apenas URL e publishable key no ambiente. Segredos nunca entram no bundle.'}</p></div>
      </div>

      <div className="admin-tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)} type="button"><Icon size={17} /> {label}</button>)}
      </div>

      {feedback && <div className={`admin-feedback ${feedback.type}`} role="status">{feedback.type === 'success' && <CheckCircle2 size={18} />}<span>{feedback.text}</span></div>}

      <section className="settings-card">
        {loading && editableTabs.has(tab)
          ? <div className="settings-loading"><LoaderCircle className="spin" size={24} /><strong>Carregando configurações reais</strong></div>
          : <>
            {tab === 'geral' && general && <GeneralSettings value={general} onChange={setGeneral} />}
            {tab === 'categorias' && <CategorySettings value={categories} onChange={setCategories} onAdd={addCategory} />}
            {tab === 'sla' && <SlaSettings value={slaPolicies} onChange={setSlaPolicies} />}
            {tab === 'notificacoes' && <NotificationSettings />}
            {tab === 'email' && <EmailSettings />}
            {tab === 'acessos' && <AccessSettings />}
            {tab === 'privacidade' && <PrivacySettings />}
          </>}
      </section>
    </InternalShell>
  )
}

function GeneralSettings({ value, onChange }: { value: GeneralState; onChange: (value: GeneralState) => void }) {
  const patch = (change: Partial<GeneralState>) => onChange({ ...value, ...change })

  return <>
    <div className="settings-heading"><h2>Identidade e funcionamento do canal</h2><p>Esses dados são carregados do Supabase. O identificador técnico da organização não pode ser alterado por esta tela.</p></div>
    <div className="two-columns">
      <label className="field"><span>Nome da organização</span><input maxLength={120} value={value.organizationName} onChange={(event) => patch({ organizationName: event.target.value })} /></label>
      <label className="field"><span>Nome público do canal</span><input maxLength={120} value={value.publicName} onChange={(event) => patch({ publicName: event.target.value })} /></label>
    </div>
    <label className="field"><span>Mensagem de acolhimento</span><textarea maxLength={2000} rows={4} value={value.welcomeText} onChange={(event) => patch({ welcomeText: event.target.value })} /></label>
    <div className="two-columns">
      <label className="field"><span>Fuso horário</span><select value={value.defaultTimezone} onChange={(event) => patch({ defaultTimezone: event.target.value })}><option value="America/Sao_Paulo">America/Sao_Paulo</option><option value="America/Manaus">America/Manaus</option><option value="America/Fortaleza">America/Fortaleza</option><option value="America/Cuiaba">America/Cuiaba</option><option value="UTC">UTC</option></select></label>
      <label className="field"><span>Versão do aviso de privacidade</span><input maxLength={50} placeholder="2026-08" value={value.privacyNoticeVersion} onChange={(event) => patch({ privacyNoticeVersion: event.target.value })} /></label>
    </div>
    <div className="setting-row"><div><strong>Permitir relato anônimo</strong><span>O formulário público poderá ser enviado sem identificação.</span></div><label className="switch"><input type="checkbox" checked={value.allowAnonymous} onChange={(event) => patch({ allowAnonymous: event.target.checked })} /><span /></label></div>
    <div className="setting-row"><div><strong>Permitir e-mail opcional</strong><span>O endereço de contato continuará separado e criptografado no fluxo público real.</span></div><label className="switch"><input type="checkbox" checked={value.allowOptionalEmail} onChange={(event) => patch({ allowOptionalEmail: event.target.checked })} /><span /></label></div>
    <div className="setting-row"><div><strong>Permitir anexos</strong><span>A política já pode ser configurada, mas o upload público só será liberado após quarentena e varredura de arquivos.</span></div><label className="switch"><input type="checkbox" checked={value.allowAttachments} onChange={(event) => patch({ allowAttachments: event.target.checked })} /><span /></label></div>
  </>
}

function CategorySettings({ value, onChange, onAdd }: { value: CategoryState[]; onChange: (value: CategoryState[]) => void; onAdd: () => void }) {
  const patch = (localKey: string, change: Partial<CategoryState>) => onChange(value.map((category) => category.localKey === localKey ? { ...category, ...change } : category))

  return <>
    <div className="settings-heading settings-heading-actions"><div><h2>Categorias de relato</h2><p>Ativação, prioridade e restrição são aplicadas ao formulário e ao roteamento dos novos relatos.</p></div><button className="button secondary compact" onClick={onAdd} type="button"><Plus size={16} /> Nova categoria</button></div>
    <div className="category-editor-list">
      {value.map((category) => <article className="category-editor" key={category.localKey}>
        <div className="category-editor-main">
          <label className="field"><span>Nome</span><input maxLength={160} value={category.name} onChange={(event) => patch(category.localKey, { name: event.target.value })} /></label>
          <label className="field"><span>Descrição</span><textarea maxLength={1200} rows={2} value={category.description} onChange={(event) => patch(category.localKey, { description: event.target.value })} /></label>
        </div>
        <div className="category-editor-controls">
          <label className="field"><span>Prioridade padrão</span><select value={category.severity_default} onChange={(event) => patch(category.localKey, { severity_default: event.target.value as Priority })}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
          <div className="compact-switch-row"><span>Ativa</span><label className="switch"><input type="checkbox" checked={category.active} onChange={(event) => patch(category.localKey, { active: event.target.checked })} /><span /></label></div>
          <div className="compact-switch-row"><span>Acesso restrito</span><label className="switch"><input type="checkbox" checked={category.restricted_by_default} onChange={(event) => patch(category.localKey, { restricted_by_default: event.target.checked })} /><span /></label></div>
        </div>
      </article>)}
    </div>
    <div className="security-callout"><Shield size={19} /><p>Categorias não são excluídas por esta tela. Para preservar histórico e referências, categorias que deixarem de ser usadas devem ser desativadas.</p></div>
  </>
}

function SlaSettings({ value, onChange }: { value: SlaState[]; onChange: (value: SlaState[]) => void }) {
  const patch = (id: string, change: Partial<SlaState>) => onChange(value.map((policy) => policy.id === id ? { ...policy, ...change } : policy))
  const hours = (minutes: number | null) => minutes == null ? '' : String(minutes / 60)
  const minutes = (raw: string, fallback: number | null) => {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.round(parsed * 60)
  }

  return <>
    <div className="settings-heading"><h2>Políticas de SLA</h2><p>Os valores abaixo são reais e, nesta etapa, usam horas corridas. Calendário útil e feriados entram na próxima evolução do motor de SLA.</p></div>
    <div className="sla-editor-grid">
      {value.map((policy) => <article className={`sla-editor priority-${policy.priority}`} key={policy.id}>
        <div className="sla-editor-title"><div><span>Prioridade</span><strong>{priorityLabels[policy.priority]}</strong></div><label className="switch"><input type="checkbox" checked={policy.active} onChange={(event) => patch(policy.id, { active: event.target.checked })} /><span /></label></div>
        <div className="two-columns">
          <label className="field"><span>Primeira ação</span><input min="0.02" step="1" type="number" value={hours(policy.first_action_minutes)} onChange={(event) => patch(policy.id, { first_action_minutes: minutes(event.target.value, policy.first_action_minutes) ?? policy.first_action_minutes })} /><small>horas corridas</small></label>
          <label className="field"><span>Triagem</span><input min="0.02" step="1" type="number" value={hours(policy.triage_minutes)} onChange={(event) => patch(policy.id, { triage_minutes: minutes(event.target.value, policy.triage_minutes) ?? policy.triage_minutes })} /><small>horas corridas</small></label>
          <label className="field"><span>Atualização ao denunciante</span><input min="0.02" step="1" type="number" value={hours(policy.update_reporter_minutes)} onChange={(event) => patch(policy.id, { update_reporter_minutes: minutes(event.target.value, policy.update_reporter_minutes) ?? policy.update_reporter_minutes })} /><small>horas corridas</small></label>
          <label className="field"><span>Meta de resolução</span><input min="0.02" step="1" type="number" value={hours(policy.resolution_target_minutes)} onChange={(event) => patch(policy.id, { resolution_target_minutes: event.target.value === '' ? null : minutes(event.target.value, policy.resolution_target_minutes) })} /><small>horas corridas</small></label>
        </div>
      </article>)}
    </div>
  </>
}

function NotificationSettings() {
  return <><PendingModule title="Notificações e escalonamento" text="A estrutura visual permanece, mas a persistência e o worker de entrega serão conectados depois dos módulos administrativos básicos." />{['Novo relato recebido', 'SLA atingiu 70%', 'SLA atingiu 90%', 'SLA vencido', 'Nova mensagem do denunciante'].map((item) => <div className="setting-row muted-setting" key={item}><div><strong>{item}</strong><span>E-mail, painel interno e futura notificação do navegador</span></div><span className="pending-pill">Em preparação</span></div>)}</>
}

function EmailSettings() {
  return <><PendingModule title="Entrega de e-mail" text="O frontend nunca armazenará credenciais SMTP. O envio será feito por função segura/API de provedor e outbox transacional." /><div className="two-columns"><label className="field"><span>Remetente exibido</span><input disabled placeholder="Canal de Integridade" /></label><label className="field"><span>E-mail do remetente</span><input disabled type="email" placeholder="integridade@empresa.com.br" /></label></div><div className="security-callout"><KeyRound size={19} /><p>API keys, senhas SMTP e secrets ficam no secret manager do backend/Supabase Edge Functions, nunca em tabelas acessíveis ao navegador.</p></div></>
}

function AccessSettings() {
  return <><PendingModule title="Papéis e acesso" text="Seu platform_admin e o MFA já são reais. A próxima etapa desta aba será gestão de usuários, papéis, status e MFA sem conceder acesso automático a relatos." />{[['Administrador do sistema', 'Configura regras, usuários e integrações. Sem acesso automático aos relatos.'], ['Gestor de Compliance', 'Gerencia fila, roteamento e indicadores autorizados.'], ['Investigador', 'Acessa apenas casos atribuídos ou liberados para seu escopo.'], ['Auditor', 'Consulta trilhas de auditoria conforme autorização.'], ['Privacy Officer', 'Atua em triagem e casos marcados como restritos.']].map(([title, text]) => <div className="role-row muted-setting" key={title}><div><strong>{title}</strong><span>{text}</span></div><span className="pending-pill">Próxima fase</span></div>)}</>
}

function PrivacySettings() {
  return <><PendingModule title="Privacidade e retenção" text="A tela será conectada depois que os parâmetros jurídicos/DPO forem aprovados. Valores de retenção não serão inventados pelo sistema." /><div className="security-callout"><Shield size={19} /><p>A retenção precisa considerar finalidade, obrigações legais, defesa de direitos e política interna aprovada. Por isso os campos demonstrativos foram removidos até a regra real existir.</p></div></>
}

function PendingModule({ title, text }: { title: string; text: string }) {
  return <div className="settings-heading"><div className="pending-heading"><span className="pending-pill">Próximo módulo</span><h2>{title}</h2></div><p>{text}</p></div>
}
