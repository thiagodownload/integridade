import { useState } from 'react'
import { Bell, Building2, Clock3, KeyRound, Mail, Save, Shield, Tags, Users } from 'lucide-react'
import { InternalShell } from '../components/InternalShell'
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
        <div><span className="eyebrow">Administração</span><h1>Regras e configurações</h1><p>Configuração do canal sem conceder acesso automático ao conteúdo das denúncias.</p></div>
        <button className="button primary"><Save size={18} /> Salvar alterações</button>
      </div>

      <div className={`connection-banner ${supabaseConfigured ? 'connected' : ''}`}>
        <span className="connection-dot" /><div><strong>{supabaseConfigured ? 'Supabase configurado no frontend' : 'Supabase ainda não conectado neste ambiente'}</strong><p>{supabaseConfigured ? 'A chave utilizada é publicável. Operações privilegiadas continuam no backend.' : 'Preencha apenas URL e publishable key no .env local. Segredos nunca entram no bundle.'}</p></div>
      </div>

      <div className="admin-tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)} type="button"><Icon size={17} /> {label}</button>)}
      </div>

      <section className="settings-card">
        {tab === 'geral' && <GeneralSettings />}
        {tab === 'categorias' && <CategorySettings />}
        {tab === 'sla' && <SlaSettings />}
        {tab === 'notificacoes' && <NotificationSettings />}
        {tab === 'email' && <EmailSettings />}
        {tab === 'acessos' && <AccessSettings />}
        {tab === 'privacidade' && <PrivacySettings />}
      </section>
    </InternalShell>
  )
}

function GeneralSettings() {
  return <><div className="settings-heading"><h2>Identidade do canal</h2><p>Configurações visuais e institucionais exibidas no portal público.</p></div><div className="two-columns"><label className="field"><span>Nome do canal</span><input defaultValue="Canal de Integridade" /></label><label className="field"><span>Nome da organização</span><input placeholder="Empresa" /></label></div><label className="field"><span>Mensagem de acolhimento</span><textarea rows={4} defaultValue="Este é um espaço seguro para registrar preocupações e situações que merecem análise." /></label></>
}

function CategorySettings() {
  return <><div className="settings-heading"><h2>Categorias de relato</h2><p>Defina categorias, disponibilidade e roteamento inicial.</p></div>{['Assédio moral', 'Assédio sexual', 'Discriminação', 'Fraude ou desvio', 'Conflito de interesses'].map((item) => <div className="setting-row" key={item}><div><strong>{item}</strong><span>Ativa no formulário público</span></div><label className="switch"><input type="checkbox" defaultChecked /><span /></label></div>)}</>
}

function SlaSettings() {
  return <><div className="settings-heading"><h2>Políticas de SLA</h2><p>Prazos precisam evoluir para calendário útil, feriados, prioridade e escalonamento.</p></div><div className="three-columns"><label className="field"><span>Primeira ação</span><input type="number" defaultValue="4" /><small>horas úteis</small></label><label className="field"><span>Triagem</span><input type="number" defaultValue="8" /><small>horas úteis</small></label><label className="field"><span>Retorno periódico</span><input type="number" defaultValue="5" /><small>dias úteis</small></label></div></>
}

function NotificationSettings() {
  return <><div className="settings-heading"><h2>Notificações e escalonamento</h2><p>Defina eventos que geram avisos sem expor detalhes sensíveis nas notificações.</p></div>{['Novo relato recebido', 'SLA atingiu 70%', 'SLA atingiu 90%', 'SLA vencido', 'Nova mensagem do denunciante'].map((item) => <div className="setting-row" key={item}><div><strong>{item}</strong><span>E-mail e painel interno</span></div><label className="switch"><input type="checkbox" defaultChecked /><span /></label></div>)}</>
}

function EmailSettings() {
  return <><div className="settings-heading"><h2>Entrega de e-mail</h2><p>O frontend nunca armazenará credenciais SMTP. O envio será feito por função segura/API de provedor.</p></div><div className="two-columns"><label className="field"><span>Remetente exibido</span><input placeholder="Canal de Integridade" /></label><label className="field"><span>E-mail do remetente</span><input type="email" placeholder="integridade@empresa.com.br" /></label></div><div className="security-callout"><KeyRound size={19} /><p>API keys, senhas SMTP e secrets devem ficar no secret manager do backend/Supabase Edge Functions, nunca em tabelas de configuração acessíveis ao navegador.</p></div></>
}

function AccessSettings() {
  return <><div className="settings-heading"><h2>Papéis e acesso</h2><p>Administração técnica e conteúdo investigativo são permissões independentes.</p></div>{[['Administrador do sistema', 'Configura regras, usuários e integrações. Sem acesso automático aos relatos.'], ['Gestor de Compliance', 'Gerencia fila, roteamento e indicadores autorizados.'], ['Investigador', 'Acessa apenas casos atribuídos ou liberados para seu escopo.'], ['Auditor', 'Consulta trilhas de auditoria conforme autorização.']].map(([title, text]) => <div className="role-row" key={title}><div><strong>{title}</strong><span>{text}</span></div><button className="button secondary compact">Configurar</button></div>)}</>
}

function PrivacySettings() {
  return <><div className="settings-heading"><h2>Privacidade e retenção</h2><p>Políticas devem ser revisadas com jurídico/DPO antes da operação real.</p></div><div className="two-columns"><label className="field"><span>Prazo padrão de retenção</span><input type="number" defaultValue="1825" /><small>dias • valor demonstrativo</small></label><label className="field"><span>Logs de auditoria</span><input type="number" defaultValue="1825" /><small>dias • valor demonstrativo</small></label></div><div className="security-callout"><Shield size={19} /><p>A retenção não deve ser escolhida por conveniência técnica. O prazo final precisa considerar finalidade, obrigações legais, defesa de direitos e política interna aprovada.</p></div></>
}
