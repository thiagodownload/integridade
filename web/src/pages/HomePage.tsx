import { ArrowRight, Clock3, KeyRound, MessageSquareLock, ShieldCheck, UserRoundX } from 'lucide-react'

const trustItems = [
  ['Sem cadastro obrigatório', UserRoundX],
  ['Disponível 24 horas', Clock3],
  ['Protocolo privado', KeyRound],
  ['Diálogo protegido', MessageSquareLock],
] as const

export function HomePage() {
  return (
    <>
      <section className="hero section-shell">
        <div className="hero-copy">
          <span className="eyebrow"><ShieldCheck size={16} /> Confidencialidade • Proteção • Não retaliação</span>
          <h1>Um canal seguro para <span>ser ouvido.</span></h1>
          <p className="hero-lead">
            Registre uma preocupação, irregularidade ou situação de assédio sem criar uma conta. Você acompanha o caso por um protocolo privado e pode continuar o diálogo sem revelar sua identidade à equipe responsável.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#/reportar">Registrar um relato <ArrowRight size={18} /></a>
            <a className="button secondary" href="#/acompanhar">Acompanhar protocolo</a>
          </div>
          <div className="trust-grid">
            {trustItems.map(([label, Icon]) => (
              <div className="trust-item" key={label}><Icon size={17} /><span>{label}</span></div>
            ))}
          </div>
        </div>

        <aside className="hero-panel" aria-label="Como funciona">
          <div className="panel-kicker">Como funciona</div>
          <h2>Quatro passos. Sem burocracia desnecessária.</h2>
          <ol className="flow-list">
            <li><span>1</span><div><strong>Registre o relato</strong><p>Conte o necessário para a análise, sem identificação obrigatória.</p></div></li>
            <li><span>2</span><div><strong>Guarde o protocolo</strong><p>Ele funciona como sua credencial privada de acompanhamento.</p></div></li>
            <li><span>3</span><div><strong>A equipe avalia</strong><p>O acesso é limitado por função, necessidade e conflito de interesse.</p></div></li>
            <li><span>4</span><div><strong>Acompanhe e responda</strong><p>Atualizações e perguntas ficam disponíveis no próprio canal.</p></div></li>
          </ol>
        </aside>
      </section>

      <section className="content-section section-shell">
        <div className="section-heading">
          <span className="eyebrow">Confiança por projeto</span>
          <h2>Privacidade não pode ser só texto no rodapé.</h2>
          <p>O desenho técnico reduz exposição, separa funções e evita que a administração do sistema tenha acesso automático ao conteúdo sensível.</p>
        </div>
        <div className="feature-grid">
          <article className="feature-card"><span>01</span><h3>Anonimato por padrão</h3><p>Identificação não é requisito. Contato opcional fica separado do conteúdo do caso.</p></article>
          <article className="feature-card"><span>02</span><h3>Protocolo não sequencial</h3><p>Códigos são imprevisíveis e tratados como credenciais, não como simples números de atendimento.</p></article>
          <article className="feature-card"><span>03</span><h3>Acesso por necessidade</h3><p>Investigadores veem apenas o que precisam. Conflitos de interesse podem bloquear acesso ao caso.</p></article>
        </div>
      </section>
    </>
  )
}
