import { useMemo, useState } from 'react'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react'
import { InternalShell } from '../components/InternalShell'

const steps = [
  {
    icon: FileCheck2,
    eyebrow: 'Etapa 1 de 6',
    title: 'Entenda sua fila',
    lead: 'Operações reúne os relatos que o seu perfil está autorizado a tratar. A fila padrão segue a ordem de chegada, do mais antigo para o mais recente.',
    points: [
      'Use os filtros para localizar casos por status, prioridade e escopo.',
      'O selo Restrito indica que o caso possui proteção adicional de acesso.',
      'O SLA ajuda a acompanhar o prazo, mas não substitui a análise do conteúdo.',
    ],
    note: 'Abra somente os casos necessários ao seu trabalho. Acesso a conteúdo restrito é auditado.',
  },
  {
    icon: ShieldCheck,
    eyebrow: 'Etapa 2 de 6',
    title: 'Faça a triagem com contexto',
    lead: 'Ao abrir um caso, leia o relato e o contexto informado antes de alterar status, prioridade ou equipe.',
    points: [
      'Revise descrição, data, local, relação e pessoas mencionadas.',
      'Use a prioridade para refletir a urgência real do tratamento.',
      'Atualize o status conforme a etapa efetiva da apuração.',
    ],
    note: 'Mudanças de status e prioridade ficam registradas no histórico. Evite alterações apenas para “organizar a tela”.',
  },
  {
    icon: UsersRound,
    eyebrow: 'Etapa 3 de 6',
    title: 'Monte a equipe certa',
    lead: 'Defina quem conduz, quem participa e quem apenas acompanha o caso.',
    points: [
      'Responsável principal: conduz o tratamento do caso.',
      'Colaborador: participa da apuração conforme suas permissões.',
      'Observador: acompanha em somente leitura, ideal para Diretoria.',
    ],
    note: 'Casos restritos exigem Privacy Officer para gestão da equipe. Incluir alguém no caso também gera aviso interno e e-mail neutro.',
  },
  {
    icon: MessageCircle,
    eyebrow: 'Etapa 4 de 6',
    title: 'Comunique-se pelo lugar certo',
    lead: 'Nota interna e mensagem ao denunciante têm finalidades diferentes. Essa distinção protege o caso e evita exposição acidental.',
    points: [
      'Nota interna: usada pela equipe. O denunciante não vê.',
      'Mensagem ao denunciante: aparece no acompanhamento pelo protocolo.',
      'Nunca copie o conteúdo do relato para WhatsApp, e-mail ou canais paralelos.',
    ],
    note: 'Antes de enviar uma mensagem, releia como se você fosse o denunciante. Se não deveria ser visto por ele, use Nota interna.',
  },
  {
    icon: LockKeyhole,
    eyebrow: 'Etapa 5 de 6',
    title: 'Trate anexos com cuidado',
    lead: 'Os anexos passam por quarentena e sanitização antes de serem disponibilizados para a equipe.',
    points: [
      'A equipe acessa a versão sanitizada/normalizada, não o original da quarentena.',
      'Baixe arquivos apenas quando houver necessidade para a apuração.',
      'Não redistribua evidências por canais externos ao Portal Integridade.',
    ],
    note: 'O portal aceita imagens, documentos e áudio nos formatos autorizados pela configuração vigente.',
  },
  {
    icon: Bell,
    eyebrow: 'Etapa 6 de 6',
    title: 'Acompanhe até o encerramento',
    lead: 'Use a Central de Notificações e mantenha o caso atualizado até a conclusão do tratamento.',
    points: [
      'O sino mostra avisos não lidos sobre relatos, mensagens e atribuições.',
      'Ative notificações do navegador para receber avisos enquanto o portal estiver aberto.',
      'Antes de encerrar, confirme se status, equipe, registros e comunicações estão coerentes.',
    ],
    note: 'O e-mail do sistema é apenas um aviso neutro. O conteúdo sensível permanece dentro do portal.',
  },
]

const quickFlow = [
  'Receba e leia o relato',
  'Faça a triagem',
  'Defina prioridade e status',
  'Defina responsável e equipe',
  'Analise anexos e evidências',
  'Registre notas internas',
  'Converse com o denunciante pelo portal',
  'Atualize o andamento',
  'Conclua e encerre o caso',
]

export function HelpPage() {
  const [stepIndex, setStepIndex] = useState(0)
  const step = steps[stepIndex]
  const StepIcon = step.icon
  const progress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex])

  return (
    <InternalShell active="help">
      <header className="internal-header help-header">
        <div>
          <span className="eyebrow">Guia rápido</span>
          <h1>Como usar o Portal Integridade</h1>
          <p>Um roteiro curto para tratar relatos com segurança, consistência e respeito às pessoas envolvidas.</p>
        </div>
        <button className="button secondary help-print" type="button" onClick={() => window.print()}>
          <CircleHelp size={17} /> Imprimir guia
        </button>
      </header>

      <section className="help-welcome dashboard-card">
        <div className="help-welcome-icon"><UserRoundCheck size={28} /></div>
        <div>
          <strong>Você não precisa memorizar o sistema.</strong>
          <span>Use este guia sempre que tiver dúvida. O tratamento acontece no portal; o tutorial apenas explica o caminho.</span>
        </div>
      </section>

      <section className="help-tour dashboard-card" aria-labelledby="help-step-title">
        <div className="help-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        <div className="help-tour-grid">
          <div className="help-step-icon"><StepIcon size={31} /></div>
          <div className="help-step-copy">
            <span className="help-step-eyebrow">{step.eyebrow}</span>
            <h2 id="help-step-title">{step.title}</h2>
            <p>{step.lead}</p>
            <ul>
              {step.points.map((point) => <li key={point}><ShieldCheck size={16} /> <span>{point}</span></li>)}
            </ul>
            <div className="help-note"><LockKeyhole size={17} /><span>{step.note}</span></div>
          </div>
        </div>

        <div className="help-tour-footer">
          <div className="help-dots" aria-label={`Etapa ${stepIndex + 1} de ${steps.length}`}>
            {steps.map((item, index) => (
              <button
                type="button"
                key={item.title}
                className={index === stepIndex ? 'active' : ''}
                aria-label={`Ir para ${item.title}`}
                aria-current={index === stepIndex ? 'step' : undefined}
                onClick={() => setStepIndex(index)}
              />
            ))}
          </div>
          <div className="help-tour-actions">
            <button className="button secondary" type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((value) => Math.max(0, value - 1))}>
              <ChevronLeft size={17} /> Anterior
            </button>
            {stepIndex < steps.length - 1 ? (
              <button className="button primary" type="button" onClick={() => setStepIndex((value) => Math.min(steps.length - 1, value + 1))}>
                Próxima etapa <ChevronRight size={17} />
              </button>
            ) : (
              <a className="button primary" href="#/operacoes">Ir para Operações <ChevronRight size={17} /></a>
            )}
          </div>
        </div>
      </section>

      <section className="help-reference-grid">
        <article className="dashboard-card help-reference-card">
          <span className="eyebrow">Fluxo em 60 segundos</span>
          <h2>Do recebimento ao encerramento</h2>
          <ol className="help-flow-list">
            {quickFlow.map((item, index) => (
              <li key={item}><span>{index + 1}</span><strong>{item}</strong></li>
            ))}
          </ol>
        </article>

        <article className="dashboard-card help-reference-card help-principles">
          <span className="eyebrow">Boas práticas</span>
          <h2>Proteja o relato e as pessoas</h2>
          <div className="help-principle-list">
            <p><ShieldCheck size={17} /><span>Leia apenas casos necessários ao seu trabalho.</span></p>
            <p><MessageCircle size={17} /><span>Use o próprio portal para comunicação e registros.</span></p>
            <p><LockKeyhole size={17} /><span>Nunca tente identificar um denunciante anônimo.</span></p>
            <p><UsersRound size={17} /><span>Conceda acesso apenas a quem realmente precisa participar.</span></p>
            <p><Bell size={17} /><span>Mantenha notificações, status e responsabilidades atualizados.</span></p>
          </div>
          <div className="help-closing">
            <strong>Regra simples</strong>
            <span>Se a informação não precisa sair do Portal Integridade, ela não deve sair do Portal Integridade.</span>
          </div>
        </article>
      </section>
    </InternalShell>
  )
}
