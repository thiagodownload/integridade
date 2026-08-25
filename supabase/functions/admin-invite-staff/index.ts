import { createClient } from 'npm:@supabase/supabase-js@2'
import { getPortalEmailConfig, sendPortalEmail } from '../_shared/portal-email.ts'

const APP_ORIGIN = 'https://integridade.mundialatacadista.com.br'
const allowedRoles = new Set([
  'platform_admin',
  'compliance_manager',
  'investigator',
  'auditor',
  'privacy_officer',
  'executive_viewer',
])

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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

type InviteInput = {
  email?: unknown
  displayName?: unknown
  roles?: unknown
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

    const input = await req.json() as InviteInput
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : ''
    const roles = Array.isArray(input.roles) ? [...new Set(input.roles.filter((role): role is string => typeof role === 'string'))] : []

    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'invalid_email' })
    if (displayName.length < 2 || displayName.length > 120) return reply(400, { error: 'invalid_display_name' })
    if (roles.length < 1 || roles.some((role) => !allowedRoles.has(role))) return reply(400, { error: 'invalid_roles' })

    const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const [{ data: profile, error: profileError }, { data: roleRows, error: roleError }] = await Promise.all([
      service.from('staff_profiles').select('organization_id,active,email').eq('user_id', actorUserId).maybeSingle(),
      service.from('staff_roles').select('role').eq('user_id', actorUserId),
    ])

    if (profileError || roleError || !profile?.active || !(roleRows ?? []).some((row) => row.role === 'platform_admin')) {
      return reply(403, { error: 'administrator_required' })
    }

    if (String(profile.email ?? '').toLowerCase() === email) return reply(400, { error: 'cannot_invite_self' })

    const organizationId = String(profile.organization_id)

    try {
      await getPortalEmailConfig(service, organizationId)
    } catch {
      return reply(409, { error: 'email_transport_not_configured' })
    }

    const { data: usersPage, error: usersError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (usersError) return reply(500, { error: 'auth_directory_unavailable' })

    let targetUser = usersPage.users.find((user) => String(user.email ?? '').toLowerCase() === email) ?? null
    let activationLink = ''
    let isNewAccount = false

    if (targetUser) {
      const { data: existingProfile } = await service.from('staff_profiles').select('user_id,email_confirmed_at').eq('user_id', targetUser.id).maybeSingle()

      if (existingProfile?.email_confirmed_at || targetUser.email_confirmed_at) {
        return reply(409, { error: 'user_already_active' })
      }

      const { data: recoveryData, error: recoveryError } = await service.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${APP_ORIGIN}/auth/ativar` },
      })
      if (recoveryError || !recoveryData?.properties?.action_link) {
        return reply(400, { error: 'activation_link_generation_failed' })
      }
      activationLink = recoveryData.properties.action_link
    } else {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const { error: prepareError } = await service.rpc('create_staff_invite_internal', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_email: email,
        p_display_name: displayName,
        p_roles: roles,
        p_expires_at: expiresAt,
      })
      if (prepareError) return reply(400, { error: 'invite_preparation_failed' })

      const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo: `${APP_ORIGIN}/auth/ativar`,
          data: { display_name: displayName },
        },
      })

      if (linkError || !linkData?.user?.id || !linkData?.properties?.action_link) {
        return reply(400, { error: 'activation_link_generation_failed' })
      }

      targetUser = linkData.user
      activationLink = linkData.properties.action_link
      isNewAccount = true
    }

    const { error: provisionError } = await service.rpc('provision_staff_user_internal', {
      p_actor_user_id: actorUserId,
      p_organization_id: organizationId,
      p_user_id: targetUser.id,
      p_email: email,
      p_display_name: displayName,
      p_roles: roles,
    })
    if (provisionError) return reply(400, { error: 'staff_provisioning_failed' })

    const safeName = escapeHtml(displayName)
    const safeLink = escapeHtml(activationLink)

    try {
      await sendPortalEmail(service, organizationId, {
        to: email,
        subject: isNewAccount ? 'Convite para acesso interno' : 'Reenvio de ativação do acesso interno',
        text: `Olá, ${displayName}. Você recebeu acesso ao Canal de Integridade. Para ativar sua conta e definir sua senha, acesse: ${activationLink} Este link é pessoal e não deve ser compartilhado.`,
        html: `<p>Olá, <strong>${safeName}</strong>.</p><p>Você recebeu acesso à área interna do Canal de Integridade.</p><p><a href="${safeLink}">Ativar acesso e definir senha</a></p><p>Depois da ativação, o sistema exigirá MFA antes de liberar a área interna.</p><p>Este link é pessoal e não deve ser compartilhado.</p>`,
      })
    } catch {
      return reply(502, { error: 'portal_email_delivery_failed', accountPrepared: true })
    }

    await service.from('audit_events').insert({
      organization_id: organizationId,
      actor_user_id: actorUserId,
      action: isNewAccount ? 'staff.invite.sent_via_portal_mail' : 'staff.invite.resent_via_portal_mail',
      object_type: 'staff_profile',
      object_id: targetUser.id,
      metadata: { role_count: roles.length },
    })

    return reply(201, { ok: true, resent: !isNewAccount })
  } catch {
    return reply(500, { error: 'unexpected_error' })
  }
})
