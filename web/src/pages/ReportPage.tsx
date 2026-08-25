import { FormEvent, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, LockKeyhole, Paperclip, ShieldCheck } from 'lucide-react'

const categories = [
  'Assédio moral',
  'Assédio sexual',
  'Discriminação',
  'Fraude ou desvio',
  'Corrupção ou suborno',
  'Conflito de interesses',
  'Violação de política interna',
  'Saúde e segurança',
  'Outro assunto',
]

function secureProtocol() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const token = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
  return `CI-26-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`
}

export function ReportPage() {
  const [step, setStep] = useState(1)
  const [protocol, setProtocol] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [goodFaith, setGoodFaith] = useState(false)

  const progress = useMemo(() => `${(step / 4) * 100}%`, [step])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step === 1 && !category) return
    if (step === 2 && description.trim().length < 20) return
    if (step === 4 && !goodFaith) return
    if (step < 4) {
      setStep((value) => value + 1)
      return
    }
    setProtocol(secureProtocol())
  }

  if (protocol) {
    return (
      <section className="narrow-page section-shell success-page">
        <div className="success-icon"><Check size={30} /></div>
        <span className="eyebrow">Relato recebido</span>
        <h1>Guarde seu protocolo em local seguro.</h1>
        <p>Ele é a chave para acompanhar atualizações e responder à equipe sem criar uma conta.</p>
        <div className="protocol-card"><small>Seu protocolo</small><strong>{protocol}</strong></div>
        <div className="hero-actions centered">
          <button className="button primary" type="button" onClick={() => navigator.clipboard?.writeText(protocol)}>Copiar protocolo</button>
          <a className="button secondary" href="#/acompanhar">Acompanhar agora</a>
        </div>
        <div className="privacy-note"><LockKeyhole size={18} /><p>Na integração real, o navegador enviará o relato para uma função pública protegida. A tabela de denúncias não ficará exposta diretamente ao cliente.</p></div>
      </section>
    )
  }

  return (
    <section className="form-page section-shell">
      <div className="page-heading">
        <span className="eyebrow"><ShieldCheck size={16} /> Novo relato</span>
        <h1>Conte o que aconteceu.</h1>
        <p>Você não precisa se identificar. Inclua apenas as informações necessárias para entender e verificar o fato.</p>
      </div>

      <div className="form-layout">
        <form className="report-form" onSubmit={submit}>
          <div className="form-progress" aria-label={`Etapa ${step} de 4`}><span style={{ width: progress }} /></div>
          <div className="step-meta"><span>Etapa {step} de 4</span><strong>{['Classificação', 'Relato', 'Evidências', 'Acompanhamento'][step - 1]}</strong></div>

          {step === 1 && (
            <fieldset>
              <legend>Qual é o assunto principal?</legend>
              <p className="field-help">Escolha a opção mais próxima. A classificação pode ser ajustada pela triagem depois.</p>
              <div className="choice-grid">
                {categories.map((item) => (
                  <label className={`choice-card ${category === item ? 'selected' : ''}`} key={item}>
                    <input type="radio" name="category" value={item} checked={category === item} onChange={() => setCategory(item)} />
                    <span>{item}</span>{category === item && <Check size={17} />}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend>Descreva a situação</legend>
              <label className="field"><span>O que aconteceu? *</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={20} required rows={8} placeholder="Descreva fatos, contexto, datas aproximadas e outras informações relevantes." /><small>{description.length} caracteres • mínimo de 20</small></label>
              <div className="two-columns">
                <label className="field"><span>Quando aconteceu?</span><input type="text" placeholder="Ex.: julho de 2026" /></label>
                <label className="field"><span>Onde aconteceu?</span><input type="text" placeholder="Unidade, setor ou contexto" /></label>
              </div>
              <label className="field"><span>Pessoas ou áreas envolvidas</span><input type="text" placeholder="Opcional. Informe apenas se necessário." /></label>
            </fieldset>
          )}

          {step === 3 && (
            <fieldset>
              <legend>Há evidências ou documentos?</legend>
              <p className="field-help">Anexos serão opcionais. Na versão conectada, passarão por validação e tratamento antes de ficarem disponíveis.</p>
              <label className="upload-zone"><Paperclip size={24} /><strong>Adicionar arquivos</strong><span>Recurso será habilitado após a camada segura de armazenamento.</span><input type="file" multiple disabled /></label>
              <div className="warning-note"><AlertTriangle size={18} /><p>Arquivos podem carregar metadados como autor, dispositivo ou localização. O pipeline de produção deverá remover metadados quando tecnicamente possível antes da liberação.</p></div>
            </fieldset>
          )}

          {step === 4 && (
            <fieldset>
              <legend>Como você quer acompanhar?</legend>
              <label className="check-card"><input type="checkbox" /><div><strong>Quero receber avisos por e-mail</strong><span>Opcional. O endereço será usado apenas para notificações e ficará separado do conteúdo do caso.</span></div></label>
              <label className="field"><span>E-mail para avisos</span><input type="email" autoComplete="email" placeholder="Opcional" /></label>
              <label className="check-card required"><input type="checkbox" checked={goodFaith} onChange={(event) => setGoodFaith(event.target.checked)} required /><div><strong>Confirmo que envio este relato de boa-fé *</strong><span>Isso significa relatar honestamente o que você acredita ter ocorrido, mesmo sem possuir todas as provas.</span></div></label>
            </fieldset>
          )}

          <div className="form-actions">
            {step > 1 ? <button className="button secondary" type="button" onClick={() => setStep((value) => value - 1)}><ChevronLeft size={18} /> Voltar</button> : <a className="button secondary" href="#/">Cancelar</a>}
            <button className="button primary" type="submit">{step === 4 ? 'Enviar relato' : 'Continuar'} {step < 4 && <ChevronRight size={18} />}</button>
          </div>
        </form>

        <aside className="form-aside">
          <div className="aside-card"><ShieldCheck size={20} /><div><strong>Identificação não é obrigatória</strong><p>Nome, CPF, matrícula e login não fazem parte do fluxo público.</p></div></div>
          <div className="aside-card"><LockKeyhole size={20} /><div><strong>O protocolo é sua chave</strong><p>Quem possuir o protocolo poderá acompanhar o caso. Guarde-o com cuidado.</p></div></div>
        </aside>
      </div>
    </section>
  )
}
