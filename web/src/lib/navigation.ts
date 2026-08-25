import { useEffect, useState } from 'react'

export type AppRoute =
  | 'home'
  | 'report'
  | 'track'
  | 'operations'
  | 'admin'
  | 'privacy'
  | 'accessibility'

const routeMap: Record<string, AppRoute> = {
  '/': 'home',
  '/reportar': 'report',
  '/acompanhar': 'track',
  '/operacoes': 'operations',
  '/admin': 'admin',
  '/privacidade': 'privacy',
  '/acessibilidade': 'accessibility',
}

function currentRoute(): AppRoute {
  const hash = window.location.hash.replace(/^#/, '') || '/'
  return routeMap[hash] ?? 'home'
}

export function useHashRoute() {
  const [route, setRoute] = useState<AppRoute>(() => currentRoute())

  useEffect(() => {
    const onHashChange = () => {
      setRoute(currentRoute())
      window.scrollTo({ top: 0, behavior: 'auto' })
    }

    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return route
}
