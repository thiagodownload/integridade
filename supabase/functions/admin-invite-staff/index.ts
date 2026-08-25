import { createClient } from 'npm:@supabase/supabase-js@2'

const APP_ORIGIN = 'https://integridade.mundialatacadista.com.br'
const allowedRoles = new Set([
  'platform_admin',
  'compliance_manager',
  'investigator',
  'auditor',
  'privacy_officer',
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

    // verify_jwt=true valida a assinatura antes da execução. Aqui usamos apenas claims do token já validado.
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

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: inviteId, error: prepareError } = await service.rpc('create_staff_invite_internal', {
      p_actor_user_id: actorUserId,
      p_organization_id: profile.organization_id,
      p_email: email,
      p_display_name: displayName,
      p_roles: roles,
      p_expires_at: expiresAt,
    })

    if (prepareError || !inviteId) return reply(400, { error: 'invite_preparation_failed' })

    const { error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${APP_ORIGIN}/auth/ativar`,
      data: { display_name: displayName },
    })

    if (inviteError) {
      await service.rpc('cancel_staff_invite_internal', {
        p_invite_id: inviteId,
        p_actor_user_id: actorUserId,
      })
      return reply(400, { error: 'invite_delivery_failed' })
    }

    // Não registrar e-mail, token, papéis ou conteúdo de convite em console.
    return reply(201, { ok: true })
  } catch {
    return reply(500, { error: 'unexpected_error' })
  }
})
