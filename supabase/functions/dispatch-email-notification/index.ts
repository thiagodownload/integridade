import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPortalEmail } from '../_shared/portal-email.ts'

const APP_ORIGIN = 'https://integridade.mundialatacadista.com.br'
const OPERATIONS_URL = `${APP_ORIGIN}/#/operacoes`

const templates = {
  'report.created': {
    subject: 'Novo relato recebido',
    text: 'Há um novo relato no Canal de Integridade aguardando triagem.',
  },
  'report.restricted.created': {
    subject: 'Novo item restrito recebido',
    text: 'Há um novo item restrito no Canal de Integridade que requer atenção autorizada.',
  },
  'sla.warning_70': {
    subject: 'Alerta de SLA',
    text: 'Um item do Canal de Integridade atingiu 70% do prazo de SLA.',
  },
  'sla.warning_90': {
    subject: 'Alerta crítico de SLA',
    text: 'Um item do Canal de Integridade atingiu 90% do prazo de SLA.',
  },
  'sla.expired': {
    subject: 'SLA vencido',
    text: 'Um item do Canal de Integridade ultrapassou o prazo de SLA.',
  },
  'report.message.created': {
    subject: 'Nova mensagem no relato',
    text: 'Há uma nova mensagem vinculada a um relato no Canal de Integridade.',
  },
} as const

type EventType = keyof typeof templates

type Input = {
  organizationId?: unknown
  eventType?: unknown
  objectId?: unknown
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1]
  if (!part) throw new Error('invalid_token')
  const padded = part.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - part.length % 4) % 4)
  return JSON.parse(atob(padded)) as Record<string, unknown>
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  try {
    const authorization = req.headers.get('authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!token) return reply(401, { error: 'authentication_required' })

    const claims = decodeJwtPayload(token)
    if (claims.role !== 'service_role') return reply(403, { error: 'service_role_required' })

    const input = await req.json() as Input
    const organizationId = typeof input.organizationId === 'string' ? input.organizationId : ''
    const eventType = typeof input.eventType === 'string' ? input.eventType as EventType : '' as EventType
    const objectId = typeof input.objectId === 'string' ? input.objectId : null

    if (!organizationId || !(eventType in templates)) return reply(400, { error: 'invalid_notification' })

    const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: ruleRows, error: rulesError } = await service
      .from('notification_rules')
      .select('destination_role')
      .eq('organization_id', organizationId)
      .eq('event_type', eventType)
      .eq('channel', 'email')
      .eq('enabled', true)

    if (rulesError) return reply(500, { error: 'notification_rules_unavailable' })

    let destinationRoles = [...new Set((ruleRows ?? []).map((row) => String(row.destination_role)).filter(Boolean))]
    if (eventType === 'report.restricted.created') {
      destinationRoles = destinationRoles.filter((role) => role === 'privacy_officer')
    }

    if (destinationRoles.length === 0) return reply(200, { ok: true, sent: 0 })

    const { data: roleRows, error: rolesError } = await service
      .from('staff_roles')
      .select('user_id,role')
      .in('role', destinationRoles)

    if (rolesError) return reply(500, { error: 'notification_recipients_unavailable' })

    const userIds = [...new Set((roleRows ?? []).map((row) => String(row.user_id)))]
    if (userIds.length === 0) return reply(200, { ok: true, sent: 0 })

    const { data: profiles, error: profilesError } = await service
      .from('staff_profiles')
      .select('user_id,email,active,email_confirmed_at')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .in('user_id', userIds)

    if (profilesError) return reply(500, { error: 'notification_recipients_unavailable' })

    const recipients = [...new Set((profiles ?? [])
      .filter((profile) => profile.email_confirmed_at && profile.email)
      .map((profile) => String(profile.email).trim().toLowerCase())
      .filter(Boolean))]

    const template = templates[eventType]
    let sent = 0

    for (const recipient of recipients) {
      try {
        await sendPortalEmail(service, organizationId, {
          to: recipient,
          subject: template.subject,
          text: `${template.text} Acesse a área interna: ${OPERATIONS_URL}`,
          html: `<p>${template.text}</p><p><a href="${OPERATIONS_URL}">Acessar a área interna</a></p><p>Por confidencialidade, esta mensagem não contém dados do relato.</p>`,
        })
        sent += 1
      } catch {
        // Uma falha individual não interrompe os demais destinatários.
      }
    }

    await service.from('audit_events').insert({
      organization_id: organizationId,
      actor_user_id: null,
      action: 'notification.email.dispatched',
      object_type: 'notification_event',
      object_id: objectId,
      metadata: { event_type: eventType, recipient_count: sent },
    })

    return reply(200, { ok: true, sent })
  } catch {
    return reply(500, { error: 'unexpected_error' })
  }
})
