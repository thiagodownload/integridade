import type { ReactNode } from 'react'
import { Bell, Gauge, LogOut, Settings, ShieldCheck } from 'lucide-react'

interface InternalShellProps {
  active: 'operations' | 'admin'
  children: ReactNode
}

export function InternalShell({ active, children }: InternalShellProps) {
  return (
    <div className="internal-layout">
      <aside className="internal-sidebar">
        <a className="internal-brand" href="#/operacoes">
          <span className="brand-icon"><ShieldCheck size={21} /></span>
          <span><strong>Integridade</strong><small>Área interna</small></span>
        </a>
        <nav className="internal-nav" aria-label="Área interna">
          <a className={active === 'operations' ? 'active' : ''} href="#/operacoes"><Gauge size={18} /> Operações</a>
          <a href="#/operacoes"><Bell size={18} /> Notificações <span className="nav-count">3</span></a>
          <a className={active === 'admin' ? 'active' : ''} href="#/admin"><Settings size={18} /> Administração</a>
        </nav>
        <div className="internal-user">
          <span className="avatar">CM</span>
          <div><strong>Compliance</strong><small>Perfil demonstrativo</small></div>
          <button type="button" aria-label="Sair"><LogOut size={17} /></button>
        </div>
      </aside>
      <main className="internal-content">{children}</main>
    </div>
  )
}
