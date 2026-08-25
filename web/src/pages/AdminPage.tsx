import { useState } from 'react'
import { Bell, Building2, Clock3, Mail, Shield, Tags, Users } from 'lucide-react'
import { CoreAdminSettings } from '../components/CoreAdminSettings'
import { InternalShell } from '../components/InternalShell'
import { PortalEmailSettingsPanel } from '../components/PortalEmailSettings'
import { NotificationSettingsPanel, PrivacySettingsPanel } from '../components/RemainingAdminSettings'
import { StaffAccessSettings } from '../components/StaffAccessSettings'
import { supabaseConfigured } from '../lib/supabase'

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

export function AdminPage() {
  const [tab, setTab] = useState<TabId>('geral')

  return (
    <InternalShell active="admin">
      <div className="internal-header">
        <div>
          <span className="eyebrow">Administração</span>
          <h1>Regras e configurações</h1>
          <p>Configuração do canal sem conceder acesso automático ao conteúdo das denúncias.</p>
        </div>
        <span className="admin-module-badge live">Módulo ativo</span>
      </div>

      <div className={`connection-banner ${supabaseConfigured ? 'connected' : ''}`}>
        <span className="connection-dot" />
        <div>
          <strong>{supabaseConfigured ? 'Supabase conectado • MFA/AAL2 obrigatório' : 'Supabase ainda não conectado neste ambiente'}</strong>
          <p>{supabaseConfigured ? 'Todos os módulos administrativos usam persistência real ou configuração governada. Alterações são auditadas no banco.' : 'Preencha apenas URL e publishable key no ambiente. Segredos nunca entram no bundle.'}</p>
        </div>
      </div>

      <div className="admin-tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => (
          <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)} type="button">
            <Icon size={17} /> {label}
          </button>
        ))}
      </div>

      <section className="settings-card">
        {(tab === 'geral' || tab === 'categorias' || tab === 'sla') && <CoreAdminSettings tab={tab} />}
        {tab === 'notificacoes' && <NotificationSettingsPanel />}
        {tab === 'email' && <PortalEmailSettingsPanel />}
        {tab === 'acessos' && <StaffAccessSettings />}
        {tab === 'privacidade' && <PrivacySettingsPanel />}
      </section>
    </InternalShell>
  )
}
