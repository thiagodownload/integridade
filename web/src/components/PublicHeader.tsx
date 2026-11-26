import { Menu, X } from 'lucide-react'
import { useState } from 'react'

export function PublicHeader() {
  const [open, setOpen] = useState(false)

  const close = () => setOpen(false)

  return (
    <header className="site-header">
      <a className="brand" href="#/" aria-label="Canal de Integridade - página inicial" onClick={close}>
        <img className="mundial-logo" src="/mundial-logo.svg" alt="Grupo Mundial" />
        <span className="brand-copy">
          <strong>Canal de Integridade</strong>
          <small>Grupo Mundial • Seguro e confidencial</small>
        </span>
      </a>

      <button
        className="mobile-menu-button"
        type="button"
        aria-label={open ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>

      <nav className={`main-nav ${open ? 'open' : ''}`} aria-label="Navegação principal">
        <a href="#/" onClick={close}>Início</a>
        <a href="#/reportar" onClick={close}>Registrar relato</a>
        <a href="#/acompanhar" onClick={close}>Acompanhar</a>
        <a className="nav-internal" href="#/operacoes" onClick={close}>Área interna</a>
      </nav>
    </header>
  )
}
