import { ShieldCheck } from 'lucide-react'

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <span className="brand-icon"><ShieldCheck size={20} /></span>
        <div>
          <strong>Canal de Integridade</strong>
          <p>Ambiente para relatos de boa-fé com confidencialidade e proteção contra retaliação.</p>
        </div>
      </div>
      <div className="footer-links">
        <a href="#/privacidade">Privacidade</a>
        <a href="#/acessibilidade">Acessibilidade</a>
      </div>
      <small>v0.2 • Aplicação em desenvolvimento</small>
    </footer>
  )
}
