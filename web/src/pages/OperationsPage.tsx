import { AlertCircle, BellRing, Clock3, Inbox, TimerReset, TrendingUp } from 'lucide-react'
import { InternalShell } from '../components/InternalShell'
import { MetricCard } from '../components/MetricCard'

const cases = [
  ['CI-2026-1042', 'Assédio moral', 'Novo', 'Alta', '1h42', 'Não atribuído'],
  ['CI-2026-1037', 'Conflito de interesses', 'Triagem', 'Média', '5h12', 'Equipe Ética'],
  ['CI-2026-1029', 'Fraude / desvio', 'Em apuração', 'Crítica', 'Vencido 4h', 'Investigação A'],
  ['CI-2026-1014', 'Discriminação', 'Aguardando relato', 'Alta', 'Pausado', 'Equipe Pessoas'],
  ['CI-2026-0998', 'Violação de política', 'Concluído', 'Baixa', 'Cumprido', 'Compliance'],
]

export function OperationsPage() {
  return (
    <InternalShell active="operations">
      <div className="internal-header">
        <div><span className="eyebrow">Operações</span><h1>Fila de atendimento</h1><p>Prioridades, SLA e distribuição dos casos autorizados para o seu perfil.</p></div>
        <button className="button secondary"><BellRing size={18} /> Ativar notificações</button>
      </div>

      <div className="metrics-grid">
        <MetricCard icon={Inbox} label="Novos hoje" value="7" helper="+2 em relação à média" />
        <MetricCard icon={TrendingUp} label="SLA primeira ação" value="94%" helper="Meta mensal: 92%" tone="success" />
        <MetricCard icon={AlertCircle} label="Casos vencidos" value="3" helper="Requerem atenção" tone="danger" />
        <MetricCard icon={Clock3} label="Tempo de triagem" value="2h18" helper="31 min abaixo da média" />
      </div>

      <div className="dashboard-layout">
        <section className="dashboard-card case-table-card">
          <header className="card-header"><div><strong>Casos recentes</strong><span>Exibição limitada por permissões e conflito de interesse.</span></div><button className="button secondary compact">Filtros</button></header>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Protocolo</th><th>Categoria</th><th>Status</th><th>Prioridade</th><th>SLA</th><th>Responsável</th></tr></thead>
              <tbody>{cases.map((row) => <tr key={row[0]}>{row.map((value, index) => <td key={value}>{index === 0 ? <strong>{value}</strong> : index === 2 ? <span className="status neutral">{value}</span> : index === 4 ? <span className={value.includes('Vencido') ? 'status danger' : 'status neutral'}>{value}</span> : value}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-card sla-card">
          <header className="card-header"><div><strong>SLA por etapa</strong><span>Últimos 30 dias</span></div><TimerReset size={20} /></header>
          {[['Primeira análise', 94], ['Triagem', 88], ['Investigação', 79], ['Retorno ao denunciante', 97]].map(([label, value]) => (
            <div className="sla-item" key={label}><div><span>{label}</span><strong>{value}%</strong></div><div className="progress-track"><span style={{ width: `${value}%` }} /></div></div>
          ))}
        </section>
      </div>
    </InternalShell>
  )
}
