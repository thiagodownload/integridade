import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, LoaderCircle, MailPlus, Save, Shield, ShieldCheck, UserRoundCog } from 'lucide-react'
import { supabase } from '../lib/supabase'

type StaffRole = 'platform_admin' | 'compliance_manager' | 'investigator' | 'auditor' | 'privacy_officer'

type StaffMember = {
  user_id: string
  email: string
  display_name: string
  active: boolean
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  mfa_verified: boolean
  roles: StaffRole[]
}

type Feedback = { type: 'success' | 'error'; text: string } | null

const roleOptions: Array<{ value: StaffRole; label: string; description: string }> = [
  { value: 'platform_admin', label: 'Administrador da plataforma', description: 'Configura regras, usuários e integrações. Não recebe acesso automático a relatos.' },
  { value: 'compliance_manager', label: 'Gestor de Compliance', description: 'Gerencia fila, roteamento e casos não restritos conforme as políticas.' },
  { value: 'investigator', label: 'Investigador', description: 'Acessa apenas casos atribuídos ou explicitamente liberados.' },
  { value: 'auditor', label: 'Auditor', description: 'Consulta trilhas de auditoria conforme autorização.' },
  { value: 'privacy_officer', label: 'Privacy Officer', description: 'Atua em triagem e casos marcados como restritos.' },
]

const roleLabel = Object.fromEntries(roleOptions.map((item) => [item.value, item.label])) as Record<StaffRole, string>

function formatDate(value: string | null) {
  if (!value) return 'Ainda não ocorreu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

async function functionErrorCode(error: unknown): Promise<{ code: string; accountPrepared: boolean }> {
  if (!error || typeof error !== 'object' || !('context' in error)) return { code: '', accountPrepared: false }
  const context = (error as { context?: unknown }).context
  if (!(context instanceof Response)) return { code: '', accountPrepared: false }
  try {
    const body = await context.clone().json() as { error?: unknown; accountPrepared?: unknown }
    return {
      code: typeof body.error === 'string' ? body.error : '',
      accountPrepared: body.accountPrepared === true,
    }
  } catch {
    return { code: '', accountPrepared: false }
  }
}

function inviteErrorMessage(code: string, accountPrepared: boolean) {
  const messages: Record<string, string> = {
    email_transport_not_configured: 'Configure, habilite e teste o serviço SMTP na aba E-mail antes de enviar convites.',
    user_already_active: 'Esse e-mail já pertence a uma conta interna ativa. Edite os papéis no diretório em vez de criar outro convite.',
    activation_link_generation_failed: 'Não foi possível gerar o link seguro de ativação. Nenhum e-mail foi enviado.',
    staff_provisioning_failed: 'A conta Auth foi localizada ou criada, mas não foi possível aplicar o perfil e os papéis internos.',
    portal_email_delivery_failed: 'A conta foi preparada, mas o SMTP do portal não conseguiu entregar o e-mail. Corrija ou teste a aba E-mail e envie o convite novamente.',
    cannot_invite_self: 'Sua própria conta não pode ser convidada por esta tela.',
    administrator_required: 'Sua sessão não possui permissão administrativa para convidar usuários.',
    mfa_required: 'A sessão precisa estar em MFA/AAL2 para convidar usuários.',
    invite_preparation_failed: 'Não foi possível preparar a autorização interna para o convite.',
    auth_directory_unavailable: 'O diretório de autenticação está temporariamente indisponível.',
    invalid_email: 'O e-mail informado é inválido.',
    invalid_display_name: 'O nome de exibição informado é inválido.',
    invalid_roles: 'Os papéis selecionados são inválidos.',
  }
  if (messages[code]) return messages[code]
  if (accountPrepared) return 'A conta foi preparada, mas a entrega do convite não foi concluída. Verifique o serviço de e-mail e tente novamente.'
  return 'Não foi possível concluir o convite. Nenhuma credencial deve ser criada manualmente no Supabase; confira a configuração de E-mail e tente novamente.'
}

export function StaffAccessSettings() {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [inviting, setInviting] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRoles, setInviteRoles] = useState<StaffRole[]>(['investigator'])

  const loadMembers = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      return
    }

    setLoading(true)
    const client = supabase
    const [{ data: userData }, profilesResult, rolesResult] = await Promise.all([
      client.auth.getUser(),
      client.from('staff_profiles')
        .select('user_id,email,display_name,active,email_confirmed_at,last_sign_in_at,mfa_verified')
        .order('display_name'),
      client.from('staff_roles').select('user_id,role'),
    ])

    if (profilesResult.error || rolesResult.error) {
      setFeedback({ type: 'error', text: 'Não foi possível carregar os usuários internos.' })
      setLoading(false)
      return
    }

    const rolesByUser = new Map<string, StaffRole[]>()
    for (const row of rolesResult.data ?? []) {
      const userId = String(row.user_id)
      const role = String(row.role) as StaffRole
      rolesByUser.set(userId, [...(rolesByUser.get(userId) ?? []), role])
    }

    setCurrentUserId(userData.user?.id ?? '')
    setMembers((profilesResult.data ?? []).map((row) => ({
      user_id: String(row.user_id),
      email: String(row.email ?? ''),
      display_name: String(row.display_name ?? ''),
      active: Boolean(row.active),
      email_confirmed_at: row.email_confirmed_at ? String(row.email_confirmed_at) : null,
      last_sign_in_at: row.last_sign_in_at ? String(row.last_sign_in_at) : null,
      mfa_verified: Boolean(row.mfa_verified),
      roles: rolesByUser.get(String(row.user_id)) ?? [],
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  const activeCount = useMemo(() => members.filter((member) => member.active).length, [members])
  const mfaCount = useMemo(() => members.filter((member) => member.mfa_verified).length, [members])

  function patchMember(userId: string, change: Partial<StaffMember>) {
    setMembers((current) => current.map((member) => member.user_id === userId ? { ...member, ...change } : member))
  }

  function toggleMemberRole(userId: string, role: StaffRole) {
    setMembers((current) => current.map((member) => {
      if (member.user_id !== userId) return member
      const roles = member.roles.includes(role)
        ? member.roles.filter((item) => item !== role)
        : [...member.roles, role]
      return { ...member, roles }
    }))
  }

  function toggleInviteRole(role: StaffRole) {
    setInviteRoles((current) => current.includes(role)
      ? current.filter((item) => item !== role)
      : [...current, role])
  }

  async function saveMember(member: StaffMember) {
    if (!supabase || member.user_id === currentUserId) return
    if (member.display_name.trim().length < 2) {
      setFeedback({ type: 'error', text: 'O nome de exibição precisa ter pelo menos 2 caracteres.' })
      return
    }
    if (member.roles.length < 1) {
      setFeedback({ type: 'error', text: 'Cada usuário interno precisa ter ao menos um papel.' })
      return
    }

    setSavingId(member.user_id)
    setFeedback(null)
    const { error } = await supabase.rpc('admin_update_staff_member', {
      p_user_id: member.user_id,
      p_display_name: member.display_name,
      p_active: member.active,
      p_roles: member.roles,
    })

    if (error) {
      setFeedback({ type: 'error', text: error.message || 'Não foi possível atualizar o usuário.' })
      setSavingId('')
      return
    }

    await loadMembers()
    setSavingId('')
    setFeedback({ type: 'success', text: 'Usuário e papéis atualizados com auditoria.' })
  }

  async function sendInvite() {
    if (!supabase || inviting) return
    const normalizedEmail = inviteEmail.trim().toLowerCase()
    const normalizedName = inviteName.trim()

    if (normalizedName.length < 2) {
      setFeedback({ type: 'error', text: 'Informe o nome do novo usuário.' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFeedback({ type: 'error', text: 'Informe um e-mail válido.' })
      return
    }
    if (inviteRoles.length < 1) {
      setFeedback({ type: 'error', text: 'Selecione ao menos um papel para o convite.' })
      return
    }

    setInviting(true)
    setFeedback(null)
    const { error } = await supabase.functions.invoke('admin-invite-staff', {
      body: { email: normalizedEmail, displayName: normalizedName, roles: inviteRoles },
    })

    if (error) {
      const details = await functionErrorCode(error)
      setFeedback({ type: 'error', text: inviteErrorMessage(details.code, details.accountPrepared) })
      await loadMembers()
      setInviting(false)
      return
    }

    setInviteName('')
    setInviteEmail('')
    setInviteRoles(['investigator'])
    await loadMembers()
    setInviting(false)
    setFeedback({ type: 'success', text: 'Convite enviado pelo serviço de e-mail do portal. O usuário deverá ativar a conta e configurar MFA no primeiro acesso.' })
  }

  return <>
    <div className="settings-heading settings-heading-actions">
      <div>
        <h2>Usuários, papéis e segurança</h2>
        <p>Gerencie quem entra na área interna. Papéis administrativos e investigativos continuam independentes.</p>
      </div>
      <div className="access-summary" aria-label="Resumo de acessos">
        <span><strong>{activeCount}</strong> ativos</span>
        <span><strong>{mfaCount}</strong> com MFA</span>
      </div>
    </div>

    {feedback && <div className={`admin-feedback ${feedback.type}`} role="status">
      {feedback.type === 'success' && <CheckCircle2 size={18} />}
      <span>{feedback.text}</span>
    </div>}

    <section className="access-invite-card">
      <div className="access-section-title">
        <span className="access-section-icon"><MailPlus size={19} /></span>
        <div><strong>Convidar usuário interno</strong><span>O Supabase Auth gera o link seguro e o serviço de e-mail configurado no portal entrega a mensagem.</span></div>
      </div>
      <div className="two-columns">
        <label className="field"><span>Nome de exibição</span><input maxLength={120} placeholder="Nome do colaborador" value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></label>
        <label className="field"><span>E-mail corporativo</span><input maxLength={320} type="email" placeholder="colaborador@empresa.com.br" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
      </div>
      <RolePicker selected={inviteRoles} onToggle={toggleInviteRole} />
      <div className="access-actions"><button className="button primary" disabled={inviting} onClick={sendInvite} type="button">{inviting ? <LoaderCircle className="spin" size={17} /> : <MailPlus size={17} />} {inviting ? 'Enviando...' : 'Enviar convite'}</button></div>
    </section>

    {loading
      ? <div className="settings-loading"><LoaderCircle className="spin" size={24} /><strong>Carregando diretório interno</strong></div>
      : <div className="staff-directory">
          {members.map((member) => {
            const isSelf = member.user_id === currentUserId
            return <article className={`staff-card ${member.active ? '' : 'inactive'}`} key={member.user_id}>
              <div className="staff-card-header">
                <div className="staff-identity">
                  <span className="staff-avatar">{member.display_name.slice(0, 2).toUpperCase()}</span>
                  <div><strong>{member.display_name}</strong><span>{member.email || 'E-mail indisponível'}</span></div>
                </div>
                <div className="staff-statuses">
                  <span className={`status-pill ${member.active ? 'ok' : 'off'}`}>{member.active ? 'Ativo' : 'Inativo'}</span>
                  <span className={`status-pill ${member.email_confirmed_at ? 'ok' : 'warn'}`}>{member.email_confirmed_at ? 'Conta confirmada' : 'Convite pendente'}</span>
                  <span className={`status-pill ${member.mfa_verified ? 'ok' : 'warn'}`}>{member.mfa_verified ? 'MFA ativo' : 'MFA pendente'}</span>
                </div>
              </div>

              <div className="staff-meta-grid">
                <div><Clock3 size={16} /><span><small>Último acesso</small><strong>{formatDate(member.last_sign_in_at)}</strong></span></div>
                <div><ShieldCheck size={16} /><span><small>Papéis atuais</small><strong>{member.roles.map((role) => roleLabel[role]).join(' • ') || 'Nenhum'}</strong></span></div>
              </div>

              <div className="two-columns staff-edit-grid">
                <label className="field"><span>Nome de exibição</span><input disabled={isSelf} maxLength={120} value={member.display_name} onChange={(event) => patchMember(member.user_id, { display_name: event.target.value })} /></label>
                <div className="setting-row staff-active-toggle"><div><strong>Acesso à área interna</strong><span>{isSelf ? 'Sua própria conta é protegida contra autodesativação.' : 'Desative para bloquear o acesso sem apagar o histórico.'}</span></div><label className="switch"><input disabled={isSelf} type="checkbox" checked={member.active} onChange={(event) => patchMember(member.user_id, { active: event.target.checked })} /><span /></label></div>
              </div>

              <RolePicker disabled={isSelf} selected={member.roles} onToggle={(role) => toggleMemberRole(member.user_id, role)} />

              <div className="access-actions">
                {isSelf
                  ? <span className="self-protection"><Shield size={16} /> Sua conta deve ser alterada por outro administrador.</span>
                  : <button className="button secondary" disabled={savingId === member.user_id} onClick={() => saveMember(member)} type="button">{savingId === member.user_id ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {savingId === member.user_id ? 'Salvando...' : 'Salvar usuário'}</button>}
              </div>
            </article>
          })}
        </div>}

    <div className="security-callout"><UserRoundCog size={19} /><p>Conceder <strong>platform_admin</strong> não libera conteúdo de denúncias. Acesso a casos continua dependendo de papéis operacionais, atribuição explícita e regras de restrição.</p></div>
  </>
}

function RolePicker({ selected, onToggle, disabled = false }: { selected: StaffRole[]; onToggle: (role: StaffRole) => void; disabled?: boolean }) {
  return <fieldset className="role-picker" disabled={disabled}>
    <legend>Papéis</legend>
    <div className="role-picker-grid">
      {roleOptions.map((role) => <label className={`role-option ${selected.includes(role.value) ? 'selected' : ''}`} key={role.value}>
        <input type="checkbox" checked={selected.includes(role.value)} onChange={() => onToggle(role.value)} />
        <span><strong>{role.label}</strong><small>{role.description}</small></span>
      </label>)}
    </div>
  </fieldset>
}
