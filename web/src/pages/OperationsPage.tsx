import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Clock3, Inbox, LoaderCircle, RefreshCw, Save, ShieldAlert, TrendingUp, Users } from 'lucide-react'
import { InternalShell } from '../components/InternalShell'
import { MetricCard } from '../components/MetricCard'
import { supabase } from '../lib/supabase'

type ReportStatus = 'new' | 'triage' | 'investigating' | 'waiting_reporter' | 'waiting_internal' | 'resolved' | 'closed' | 'dismissed'
type ReportPriority = 'low' | 'medium' | 'high' | 'critical'
type StaffRole = 'platform_admin' | 'compliance_manager' | 'investigator' | 'auditor' | 'privacy_officer'
type SlaState = 'paused' | 'completed' | 'unconfigured' | 'overdue' | 'critical' | 'warning' | 'ok'

type QueueCase = {
  id: string
  category_name: string | null
  status: ReportStatus
  priority: ReportPriority
  restricted: boolean
  created_at: string
  first_action_at: string | null
  triaged_at: string | null
  resolved_at: string | null
  sla_paused_at: string | null
  principal_user_id: string | null
  principal_name: string | null
  collaborator_count: number
  sla_stage: string
  sla_deadline: string | null
  sla_percent: number | null
  sla_state: SlaState
}

type AssignmentPerson = {
  userId: string
  displayName: string
  assignedAt: string
}

type CaseDetail = {
  id: string
  categoryId: string | null
  categoryName: string | null
  status: ReportStatus
  priority: ReportPriority
  restricted: boolean
  relationship: string | null
  location: string | null
  occurredOn: string | null
  ongoing: boolean | null
  description: string
  peopleInvolved: string | null
  createdAt: string
  firstActionAt: string | null
  triagedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  slaPausedAt: string | null
  slaPauseReason: string | null
  principal: AssignmentPerson | null
  collaborators: AssignmentPerson[]
}

type Candidate = {
  user_id: string
  display_name: string
  email: string | null
  roles: StaffRole[]
}

const statusOptions: Array<{ value: ReportStatus; label: string }> = [
  { value: 'new', label: 'Novo' },
  { value: 'triage', label: 'Em triagem' },
  { value: 'investigating', label: 'Em investigação' },
  { value: 'waiting_reporter', label: 'Aguardando denunciante' },
  { value: 'waiting_internal', label: 'Aguardando interno' },
  { value: 'resolved', label: 'Concluído' },
  { value: 'closed', label: 'Encerrado' },
  { value: 'dismissed', label: 'Descartado' },
]

const priorityOptions: Array<{ value: ReportPriority; label: string }> = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
  { value: 'critical', label: 'Crítica' },
]

const statusLabel = Object.fromEntries(statusOptions.map((item) => [item.value, item.label])) as Record<ReportStatus, string>
const priorityLabel = Object.fromEntries(priorityOptions.map((item) => [item.value, item.label])) as Record<ReportPriority, string>

function caseReference(id: string) {
  return `CASO-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`
}

function formatDate(value: string | null) {
  if (!value) return 'Não registrado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function formatDue(value: string | null, state: SlaState) {
  if (state === 'paused') return 'Pausado'
  if (state === 'completed') return 'Cumprido'
  if (!value) return 'Sem SLA'
  const diffMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  const absolute = Math.abs(diffMinutes)
  const amount = absolute >= 1440 ? `${Math.round(absolute / 1440)}d` : absolute >= 60 ? `${Math.round(absolute / 60)}h` : `${absolute}min`
  return diffMinutes < 0 ? `Vencido ${amount}` : `Restam ${amount}`
}

function isToday(value: string) {
  const date = new Date(value)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

export function OperationsPage() {
  const [cases, setCases] = useState<QueueCase[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ReportStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | ReportPriority>('all')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'standard' | 'restricted'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [roles, setRoles] = useState<StaffRole[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [principalDraft, setPrincipalDraft] = useState('')
  const [collaboratorDraft, setCollaboratorDraft] = useState<string[]>([])
  const [statusDraft, setStatusDraft] = useState<ReportStatus>('new')
  const [priorityDraft, setPriorityDraft] = useState<ReportPriority>('medium')
  const [savingTeam, setSavingTeam] = useState(false)
  const [savingState, setSavingState] = useState(false)

  async function loadIdentity() {
    if (!supabase) return
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id ?? ''
    setCurrentUserId(userId)
    if (!userId) return
    const { data } = await supabase.from('staff_roles').select('role').eq('user_id', userId)
    setRoles((data ?? []).map((row) => String(row.role) as StaffRole))
  }

  async function loadQueue() {
    if (!supabase) {
      setLoading(false)
      return
    }
    setLoading(true)
    setFeedback('')
    const { data, error } = await supabase.rpc('operations_list_reports')
    if (error) {
      setFeedback('Não foi possível carregar a fila autorizada. Verifique sua sessão e o MFA.')
      setCases([])
    } else {
      setCases((data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        category_name: row.category_name == null ? null : String(row.category_name),
        status: String(row.status) as ReportStatus,
        priority: String(row.priority) as ReportPriority,
        restricted: Boolean(row.restricted),
        created_at: String(row.created_at),
        first_action_at: row.first_action_at == null ? null : String(row.first_action_at),
        triaged_at: row.triaged_at == null ? null : String(row.triaged_at),
        resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
        sla_paused_at: row.sla_paused_at == null ? null : String(row.sla_paused_at),
        principal_user_id: row.principal_user_id == null ? null : String(row.principal_user_id),
        principal_name: row.principal_name == null ? null : String(row.principal_name),
        collaborator_count: Number(row.collaborator_count ?? 0),
        sla_stage: String(row.sla_stage ?? 'none'),
        sla_deadline: row.sla_deadline == null ? null : String(row.sla_deadline),
        sla_percent: row.sla_percent == null ? null : Number(row.sla_percent),
        sla_state: String(row.sla_state ?? 'unconfigured') as SlaState,
      })))
    }
    setLoading(false)
  }

  useEffect(() => {
    void Promise.all([loadIdentity(), loadQueue()])
  }, [])

  async function openCase(reportId: string) {
    if (!supabase) return
    setSelectedId(reportId)
    setDetailLoading(true)
    setFeedback('')
    const { data, error } = await supabase.rpc('operations_get_report_detail', { p_report_id: reportId })
    if (error || !data) {
      setDetail(null)
      setFeedback('Não foi possível abrir este caso ou seu perfil não possui acesso ao conteúdo.')
      setDetailLoading(false)
      return
    }

    const parsed = data as unknown as CaseDetail
    setDetail(parsed)
    setPrincipalDraft(parsed.principal?.userId ?? '')
    setCollaboratorDraft((parsed.collaborators ?? []).map((person) => person.userId))
    setStatusDraft(parsed.status)
    setPriorityDraft(parsed.priority)

    const canManage = parsed.restricted ? roles.includes('privacy_officer') : roles.includes('compliance_manager')
    if (canManage) {
      const { data: candidateRows } = await supabase.rpc('operations_assignment_candidates', { p_report_id: reportId })
      setCandidates((candidateRows ?? []).map((row: Record<string, unknown>) => ({
        user_id: String(row.user_id),
        display_name: String(row.display_name ?? ''),
        email: row.email == null ? null : String(row.email),
        roles: Array.isArray(row.roles) ? row.roles.map((role) => String(role) as StaffRole) : [],
      })))
    } else {
      setCandidates([])
    }
    setDetailLoading(false)
  }

  async function reloadSelected() {
    await loadQueue()
    if (selectedId) await openCase(selectedId)
  }

  async function saveTeam() {
    if (!supabase || !detail || savingTeam) return
    setSavingTeam(true)
    setFeedback('')
    const { error } = await supabase.rpc('operations_set_report_team', {
      p_report_id: detail.id,
      p_principal_user_id: principalDraft || null,
      p_collaborator_user_ids: collaboratorDraft,
    })
    if (error) setFeedback('Não foi possível atualizar a equipe do caso. Confira os papéis selecionados.')
    else setFeedback('Equipe do caso atualizada e auditada.')
    await reloadSelected()
    setSavingTeam(false)
  }

  async function saveState() {
    if (!supabase || !detail || savingState) return
    setSavingState(true)
    setFeedback('')
    const canManageTeam = detail.restricted ? roles.includes('privacy_officer') : roles.includes('compliance_manager')
    const canChangeStatus = canManageTeam || detail.principal?.userId === currentUserId
    const { error } = await supabase.rpc('operations_update_report_state', {
      p_report_id: detail.id,
      p_status: canChangeStatus ? statusDraft : null,
      p_priority: canManageTeam ? priorityDraft : null,
    })
    if (error) setFeedback('Não foi possível atualizar status ou prioridade com as permissões atuais.')
    else setFeedback('Andamento do caso atualizado e auditado.')
    await reloadSelected()
    setSavingState(false)
  }

  function toggleCollaborator(userId: string) {
    if (userId === principalDraft) return
    setCollaboratorDraft((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId])
  }

  const filteredCases = useMemo(() => {
    const term = search.trim().toLowerCase()
    return cases.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false
      if (scopeFilter === 'standard' && item.restricted) return false
      if (scopeFilter === 'restricted' && !item.restricted) return false
      if (term && ![caseReference(item.id), item.category_name ?? '', item.principal_name ?? ''].some((value) => value.toLowerCase().includes(term))) return false
      return true
    })
  }, [cases, priorityFilter, scopeFilter, search, statusFilter])

  const metrics = useMemo(() => ({
    newToday: cases.filter((item) => item.status === 'new' && isToday(item.created_at)).length,
    active: cases.filter((item) => !['resolved', 'closed', 'dismissed'].includes(item.status)).length,
    atRisk: cases.filter((item) => item.sla_state === 'warning' || item.sla_state === 'critical').length,
    overdue: cases.filter((item) => item.sla_state === 'overdue').length,
  }), [cases])

  const slaBreakdown = useMemo(() => ({
    ok: cases.filter((item) => item.sla_state === 'ok').length,
    warning: cases.filter((item) => item.sla_state === 'warning').length,
    critical: cases.filter((item) => item.sla_state === 'critical').length,
    overdue: cases.filter((item) => item.sla_state === 'overdue').length,
    paused: cases.filter((item) => item.sla_state === 'paused').length,
  }), [cases])

  const canManageTeam = detail ? (detail.restricted ? roles.includes('privacy_officer') : roles.includes('compliance_manager')) : false
  const canChangeStatus = detail ? (canManageTeam || detail.principal?.userId === currentUserId) : false

  return (
    <InternalShell active="operations">
      <div className="internal-header">
        <div><span className="eyebrow">Operações</span><h1>Fila de atendimento</h1><p>Casos reais do Supabase, limitados por papel, atribuição, restrição e MFA.</p></div>
        <button className="button secondary" disabled={loading} onClick={() => void loadQueue()} type="button">{loading ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />} Atualizar fila</button>
      </div>

      {feedback && <div className="operations-feedback" role="status">{feedback}</div>}

      <div className="metrics-grid">
        <MetricCard icon={Inbox} label="Novos hoje" value={String(metrics.newToday)} helper="Visíveis para o seu perfil" />
        <MetricCard icon={TrendingUp} label="Em andamento" value={String(metrics.active)} helper="Exclui concluídos e encerrados" />
        <MetricCard icon={AlertCircle} label="SLA em risco" value={String(metrics.atRisk)} helper="Faixas de 70% e 90%" tone="warning" />
        <MetricCard icon={Clock3} label="Casos vencidos" value={String(metrics.overdue)} helper="Requerem atenção" tone="danger" />
      </div>

      <div className="operations-filters">
        <label className="field"><span>Pesquisar</span><input placeholder="Caso, categoria ou responsável" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ReportStatus)}><option value="all">Todos</option>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="field"><span>Prioridade</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as 'all' | ReportPriority)}><option value="all">Todas</option>{priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="field"><span>Escopo</span><select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as typeof scopeFilter)}><option value="all">Todos autorizados</option><option value="standard">Não restritos</option><option value="restricted">Restritos</option></select></label>
      </div>

      <div className="dashboard-layout operations-layout">
        <section className="dashboard-card case-table-card">
          <header className="card-header"><div><strong>Casos autorizados</strong><span>{filteredCases.length} de {cases.length} na fila atual.</span></div></header>
          {loading
            ? <div className="operations-empty"><LoaderCircle className="spin" size={24} /><strong>Carregando fila real</strong></div>
            : filteredCases.length === 0
              ? <div className="operations-empty"><Inbox size={28} /><strong>Nenhum caso nesta visão</strong><span>A fila usa dados reais. Se ainda não há relatos autorizados, nada é inventado para preencher a tabela.</span></div>
              : <div className="table-scroll">
                  <table>
                    <thead><tr><th>Caso</th><th>Categoria</th><th>Status</th><th>Prioridade</th><th>SLA</th><th>Equipe</th><th /></tr></thead>
                    <tbody>{filteredCases.map((item) => <tr className={selectedId === item.id ? 'selected-row' : ''} key={item.id}>
                      <td><strong>{caseReference(item.id)}</strong>{item.restricted && <span className="restricted-mini"><ShieldAlert size={12} /> restrito</span>}</td>
                      <td>{item.category_name ?? 'Sem categoria'}</td>
                      <td><span className="status neutral">{statusLabel[item.status]}</span></td>
                      <td><span className={`priority-pill ${item.priority}`}>{priorityLabel[item.priority]}</span></td>
                      <td><span className={`status ${item.sla_state === 'overdue' || item.sla_state === 'critical' ? 'danger' : 'neutral'}`}>{formatDue(item.sla_deadline, item.sla_state)}</span></td>
                      <td>{item.principal_name ?? 'Não atribuído'}{item.collaborator_count > 0 && <small className="collaborator-count">+{item.collaborator_count}</small>}</td>
                      <td><button className="button secondary compact" onClick={() => void openCase(item.id)} type="button">Abrir</button></td>
                    </tr>)}</tbody>
                  </table>
                </div>}
        </section>

        <section className="dashboard-card sla-card">
          <header className="card-header"><div><strong>SLA da fila</strong><span>Estado atual dos casos visíveis</span></div><Clock3 size={20} /></header>
          {[['Dentro do prazo', slaBreakdown.ok, cases.length], ['Atenção 70%', slaBreakdown.warning, cases.length], ['Crítico 90%', slaBreakdown.critical, cases.length], ['Vencidos', slaBreakdown.overdue, cases.length], ['Pausados', slaBreakdown.paused, cases.length]].map(([label, value, total]) => {
            const numericValue = Number(value)
            const percent = Number(total) > 0 ? Math.round(numericValue / Number(total) * 100) : 0
            return <div className="sla-item" key={String(label)}><div><span>{label}</span><strong>{numericValue}</strong></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div></div>
          })}
        </section>
      </div>

      {selectedId && <section className="dashboard-card case-detail-card">
        {detailLoading
          ? <div className="operations-empty"><LoaderCircle className="spin" size={24} /><strong>Abrindo caso</strong></div>
          : detail && <>
              <header className="case-detail-header">
                <div><span className="eyebrow">{caseReference(detail.id)}</span><h2>{detail.categoryName ?? 'Relato sem categoria'}</h2><p>Recebido em {formatDate(detail.createdAt)}</p></div>
                <div className="case-detail-badges"><span className={`priority-pill ${detail.priority}`}>{priorityLabel[detail.priority]}</span>{detail.restricted && <span className="status danger"><ShieldAlert size={13} /> Restrito</span>}</div>
              </header>

              {detail.restricted && <div className="restricted-callout"><ShieldAlert size={20} /><div><strong>Acesso restrito</strong><span>A abertura deste conteúdo foi registrada na auditoria. A equipe só pode ser alterada por Privacy Officer.</span></div></div>}

              <div className="case-detail-grid">
                <div className="case-detail-main">
                  <article className="case-section"><h3>Relato</h3><p className="report-description">{detail.description}</p></article>
                  <article className="case-section"><h3>Contexto informado</h3><dl className="case-facts"><div><dt>Relação</dt><dd>{detail.relationship || 'Não informado'}</dd></div><div><dt>Local</dt><dd>{detail.location || 'Não informado'}</dd></div><div><dt>Data do fato</dt><dd>{detail.occurredOn || 'Não informada'}</dd></div><div><dt>Em andamento</dt><dd>{detail.ongoing == null ? 'Não informado' : detail.ongoing ? 'Sim' : 'Não'}</dd></div><div className="wide"><dt>Pessoas envolvidas</dt><dd>{detail.peopleInvolved || 'Não informado'}</dd></div></dl></article>
                </div>

                <aside className="case-detail-side">
                  <article className="case-section"><h3>Andamento</h3>
                    <label className="field"><span>Status</span><select disabled={!canChangeStatus} value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as ReportStatus)}>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                    <label className="field"><span>Prioridade</span><select disabled={!canManageTeam} value={priorityDraft} onChange={(event) => setPriorityDraft(event.target.value as ReportPriority)}>{priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                    {(canChangeStatus || canManageTeam) && <button className="button primary compact" disabled={savingState} onClick={() => void saveState()} type="button">{savingState ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Salvar andamento</button>}
                  </article>

                  <article className="case-section"><h3><Users size={17} /> Equipe do caso</h3>
                    {canManageTeam
                      ? <>
                          <label className="field"><span>Responsável principal</span><select value={principalDraft} onChange={(event) => { const value = event.target.value; setPrincipalDraft(value); setCollaboratorDraft((current) => current.filter((id) => id !== value)) }}><option value="">Não atribuído</option>{candidates.map((person) => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label>
                          <div className="collaborator-picker"><strong>Colaboradores</strong>{candidates.filter((person) => person.user_id !== principalDraft).map((person) => <label key={person.user_id}><input checked={collaboratorDraft.includes(person.user_id)} onChange={() => toggleCollaborator(person.user_id)} type="checkbox" /><span><b>{person.display_name}</b><small>{person.roles.map((role) => role === 'investigator' ? 'Investigador' : role === 'compliance_manager' ? 'Gestor de Compliance' : role === 'privacy_officer' ? 'Privacy Officer' : role).join(' • ')}</small></span></label>)}</div>
                          <button className="button secondary compact" disabled={savingTeam} onClick={() => void saveTeam()} type="button">{savingTeam ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Salvar equipe</button>
                        </>
                      : <div className="team-readonly"><div><small>Principal</small><strong>{detail.principal?.displayName ?? 'Não atribuído'}</strong></div><div><small>Colaboradores</small><strong>{detail.collaborators.length ? detail.collaborators.map((person) => person.displayName).join(' • ') : 'Nenhum'}</strong></div></div>}
                  </article>
                </aside>
              </div>
            </>}
      </section>}
    </InternalShell>
  )
}
