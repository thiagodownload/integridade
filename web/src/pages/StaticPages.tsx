import { Accessibility, LockKeyhole } from 'lucide-react'

export function PrivacyPage() {
  return <section className="legal-page section-shell"><span className="eyebrow"><LockKeyhole size={16} /> Privacidade</span><h1>Privacidade desde a concepção.</h1><p>Esta página ainda é um rascunho de produto. A versão final deverá explicar, em linguagem clara, quais dados são tratados, por qual finalidade, quem pode acessá-los, prazos de retenção, direitos aplicáveis e canais de contato.</p><div className="legal-card"><h2>Princípios já definidos</h2><ul><li>Identificação não obrigatória no relato público.</li><li>Contato opcional separado do conteúdo do caso.</li><li>Acesso administrativo não implica acesso investigativo.</li><li>Auditoria de ações sensíveis.</li><li>Minimização de dados e retenção definida por política formal.</li></ul></div></section>
}

export function AccessibilityPage() {
  return <section className="legal-page section-shell"><span className="eyebrow"><Accessibility size={16} /> Acessibilidade</span><h1>O canal precisa funcionar para todos.</h1><p>A interface será desenvolvida com foco em WCAG 2.2 nível AA, navegação por teclado, foco visível, estrutura semântica, contraste adequado, mensagens compreensíveis e suporte a tecnologias assistivas.</p><div className="legal-card"><h2>Critérios de produto</h2><ul><li>Uso completo por teclado.</li><li>Campos com rótulos e mensagens de erro associadas.</li><li>Sem informação transmitida apenas por cor.</li><li>Layout responsivo e zoom sem perda de conteúdo.</li><li>Movimento não essencial reduzível.</li></ul></div></section>
}
