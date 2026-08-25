import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string
  helper: string
  icon: LucideIcon
  tone?: 'default' | 'warning' | 'danger' | 'success'
}

export function MetricCard({ label, value, helper, icon: Icon, tone = 'default' }: MetricCardProps) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon"><Icon size={20} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  )
}
