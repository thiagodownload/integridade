import { ProtectedInternalRoute } from './components/ProtectedInternalRoute'
import { PublicFooter } from './components/PublicFooter'
import { PublicHeader } from './components/PublicHeader'
import { useHashRoute } from './lib/navigation'
import { ActivateAccountPage } from './pages/ActivateAccountPage'
import { AdminPage } from './pages/AdminPage'
import { HomePage } from './pages/HomePage'
import { OperationsPage } from './pages/OperationsPage'
import { ReportPage } from './pages/ReportPage'
import { AccessibilityPage, PrivacyPage } from './pages/StaticPages'
import { TrackPage } from './pages/TrackPage'

export default function App() {
  if (window.location.pathname === '/auth/ativar') return <ActivateAccountPage />
  return <HashApplication />
}

function HashApplication() {
  const route = useHashRoute()
  const internal = route === 'operations' || route === 'admin'

  const page = (() => {
    switch (route) {
      case 'report': return <ReportPage />
      case 'track': return <TrackPage />
      case 'operations': return <ProtectedInternalRoute area="operations"><OperationsPage /></ProtectedInternalRoute>
      case 'admin': return <ProtectedInternalRoute area="admin"><AdminPage /></ProtectedInternalRoute>
      case 'privacy': return <PrivacyPage />
      case 'accessibility': return <AccessibilityPage />
      default: return <HomePage />
    }
  })()

  if (internal) return page

  return (
    <div className="public-app">
      <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
      <PublicHeader />
      <main id="main-content">{page}</main>
      <PublicFooter />
    </div>
  )
}
