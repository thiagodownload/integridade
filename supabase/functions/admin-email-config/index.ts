import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPortalEmail, verifyPortalEmailTransport } from '../_shared/portal-email.ts'

const APP_ORIGIN = 'https://integridade.mundialatacadista.com.br'

const corsHeaders = {
  'access-control-allow-origin': APP_ORIGIN,
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
}

const jsonHeaders = {
  ...corsHeaders,
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
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
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

type SaveInput = {
  action?: unknown
  senderName?: unknown
  senderEmail?: unknown
  replyToEmail?: unknown
  subjectPrefix?: unknown
  transportEnabled?: unknown
  smtpHost?: unknown
  smtpPort?: unknown
  smtpSecure?: unknown
  smtpRequireTls?: unknown
  smtpUsername?: unknown
  smtpPassword?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  try {
    const origin = req.headers.get('origin')
    if (origin && origin !== APP_ORIGIN) return reply(403, { error: 'origin_not_allowed' })

    const authorization = req.headers.get('authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!token) return reply(401, { error: 'authentication_required' })

    const claims = decodeJwtPayload(token)
    const actorUserId = typeof claims.sub === 'string' ? claims.sub : ''
    if (!actorUserId || claims.aal !== 'aal2') return reply(403, { error: 'mfa_required' })

    const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] = await Promise.all([
      service.from('staff_profiles').select('organization_id,active,email,display_name').eq('user_id', actorUserId).maybeSingle(),
      service.from('staff_roles').select('role').eq('user_id', actorUserId),
    ])

    if (
      profileError ||
      rolesError ||
      !profile?.active ||
      !(roles ?? []).some((row) => row.role === 'platform_admin')
    ) {
      return reply(403, { error: 'administrator_required' })
    }

    const input = await req.json() as SaveInput
    const action = input.action === 'test' ? 'test' : 'save'
    const organizationId = String(profile.organization_id)

    if (action === 'test') {
      const recipient = String(profile.email ?? '').trim().toLowerCase()
      if (!recipient) return reply(400, { error: 'administrator_email_missing' })

      try {
        await verifyPortalEmailTransport(service, organizationId)
        await sendPortalEmail(service, organizationId, {
          to: recipient,
          subject: 'Teste de envio',
          text: 'O serviço SMTP do Canal de Integridade está configurado e conseguiu enviar esta mensagem.',
          html: '<p>O serviço SMTP do <strong>Canal de Integridade</strong> está configurado e conseguiu enviar esta mensagem.</p>',
        })
        await service.rpc('record_email_test_internal', {
          p_actor_user_id: actorUserId,
          p_organization_id: organizationId,
          p_ok: true,
          p_error: null,
        })
        return reply(200, { ok: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'smtp_test_failed'
        await service.rpc('record_email_test_internal', {
          p_actor_user_id: actorUserId,
          p_organization_id: organizationId,
          p_ok: false,
          p_error: message,
        })
        return reply(400, { error: message === 'email_transport_not_configured' ? message : 'smtp_test_failed' })
      }
    }

    const senderName = typeof input.senderName === 'string' ? input.senderName.trim() : ''
    const senderEmail = typeof input.senderEmail === 'string' ? input.senderEmail.trim().toLowerCase() : ''
    const replyToEmail = typeof input.replyToEmail === 'string' ? input.replyToEmail.trim().toLowerCase() : ''
    const subjectPrefix = typeof input.subjectPrefix === 'string' ? input.subjectPrefix.trim() : ''
    const smtpHost = typeof input.smtpHost === 'string' ? input.smtpHost.trim().toLowerCase() : ''
    const smtpUsername = typeof input.smtpUsername === 'string' ? input.smtpUsername.trim() : ''
    const smtpPassword = typeof input.smtpPassword === 'string' ? input.smtpPassword : ''
    const smtpPort = Number(input.smtpPort)
    const transportEnabled = input.transportEnabled === true
    const smtpSecure = input.smtpSecure === true
    const smtpRequireTls = input.smtpRequireTls !== false

    if (senderName.length < 2 || senderName.length > 120) return reply(400, { error: 'invalid_sender_name' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) return reply(400, { error: 'invalid_sender_email' })
    if (replyToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToEmail)) return reply(400, { error: 'invalid_reply_to' })
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) return reply(400, { error: 'invalid_smtp_port' })
    if (transportEnabled && (!smtpHost || !smtpUsername)) return reply(400, { error: 'smtp_configuration_incomplete' })

    const { error: saveError } = await service.rpc('admin_save_email_transport_internal', {
      p_actor_user_id: actorUserId,
      p_organization_id: organizationId,
      p_sender_name: senderName,
      p_sender_email: senderEmail,
      p_reply_to_email: replyToEmail,
      p_subject_prefix: subjectPrefix,
      p_transport_enabled: transportEnabled,
      p_smtp_host: smtpHost,
      p_smtp_port: smtpPort,
      p_smtp_secure: smtpSecure,
      p_smtp_require_tls: smtpRequireTls,
      p_smtp_username: smtpUsername,
      p_smtp_password: smtpPassword,
    })

    if (saveError) {
      const message = saveError.message ?? ''
      if (message.includes('Senha SMTP ainda nao configurada')) return reply(400, { error: 'smtp_password_required' })
      return reply(400, { error: 'email_configuration_failed' })
    }

    return reply(200, { ok: true })
  } catch {
    return reply(500, { error: 'unexpected_error' })
  }
})
