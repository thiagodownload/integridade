import { createClient } from 'npm:@supabase/supabase-js@2'
import { getPortalEmailConfig, sendPortalEmail } from '../_shared/portal-email.ts'

const APP_ORIGIN = 'https://integridade.mundialatacadista.com.br'

const corsHeaders = {
  'access-control-allow-origin': APP_ORIGIN,
  'access-control-allow-headers': 'apikey, content-type, x-client-info',
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

async function digestEmail(email: string) {
  const bytes = new TextEncoder().encode(email)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  const origin = req.headers.get('origin')
  if (origin !== APP_ORIGIN) return reply(403, { error: 'origin_not_allowed' })

  try {
    const input = await req.json() as { email?: unknown }
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''

    // Resposta neutra para não revelar quais e-mails possuem conta interna.
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply(200, { ok: true })
    }

    const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: organization, error: organizationError } = await service
      .from('organizations')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (organizationError || !organization?.id) return reply(503, { error: 'recovery_temporarily_unavailable' })
    const organizationId = String(organization.id)

    // Falha de transporte é global, portanto pode ser informada sem enumerar usuário.
    try {
      await getPortalEmailConfig(service, organizationId)
    } catch {
      return reply(503, { error: 'recovery_temporarily_unavailable' })
    }

    const digest = await digestEmail(email)
    const { data: claimed } = await service.rpc('claim_password_recovery_internal', {
      p_email_digest: digest,
      p_window_minutes: 5,
    })

    if (claimed !== true) return reply(200, { ok: true })

    const { data: profile } = await service
      .from('staff_profiles')
      .select('user_id,display_name,active,email')
      .eq('organization_id', organizationId)
      .eq('email', email)
      .maybeSingle()

    if (!profile?.active || String(profile.email ?? '').toLowerCase() !== email) {
      return reply(200, { ok: true })
    }

    const { data: recoveryData, error: recoveryError } = await service.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${APP_ORIGIN}/auth/ativar` },
    })

    const actionLink = recoveryData?.properties?.action_link
    if (recoveryError || !actionLink) return reply(200, { ok: true })

    const displayName = String(profile.display_name ?? 'Usuário')
    const safeName = escapeHtml(displayName)
    const safeLink = escapeHtml(actionLink)

    try {
      await sendPortalEmail(service, organizationId, {
        to: email,
        subject: 'Recuperação de acesso',
        text: `Olá, ${displayName}. Foi solicitada a recuperação do seu acesso ao Canal de Integridade. Para definir uma nova senha, acesse: ${actionLink} Se você não fez esta solicitação, ignore esta mensagem.`,
        html: `<p>Olá, <strong>${safeName}</strong>.</p><p>Foi solicitada a recuperação do seu acesso ao Canal de Integridade.</p><p><a href="${safeLink}">Definir uma nova senha</a></p><p>Se você não fez esta solicitação, ignore esta mensagem.</p>`,
      })

      await service.from('audit_events').insert({
        organization_id: organizationId,
        actor_user_id: null,
        action: 'staff.password_recovery.sent_via_portal_mail',
        object_type: 'staff_profile',
        object_id: String(profile.user_id),
        metadata: {},
      })
    } catch {
      // Não variar a resposta pública conforme existência do usuário ou falha de entrega.
    }

    return reply(200, { ok: true })
  } catch {
    return reply(200, { ok: true })
  }
})
