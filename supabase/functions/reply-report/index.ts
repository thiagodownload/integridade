import { createClient } from 'npm:@supabase/supabase-js@2'
import { protocolDigest, requiredEnv } from '../_shared/security.ts'

const APP_ORIGIN = 'https://integridade.mundialatacadista.com.br'
const protocolPattern = /^CI-\d{2}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

const corsHeaders = {
  'access-control-allow-origin': APP_ORIGIN,
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
}
const jsonHeaders = { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  const origin = req.headers.get('origin')
  if (origin && origin !== APP_ORIGIN) return reply(403, { error: 'origin_not_allowed' })

  try {
    const input = await req.json() as { protocol?: unknown; body?: unknown }
    const protocol = typeof input.protocol === 'string' ? input.protocol.trim().toUpperCase() : ''
    const body = typeof input.body === 'string' ? input.body.trim() : ''

    if (!protocolPattern.test(protocol)) return reply(400, { error: 'invalid_protocol' })
    if (!body || body.length > 8000) return reply(400, { error: 'invalid_message_body' })

    const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const digest = await protocolDigest(protocol)
    const { data: messageId, error } = await service.rpc('add_reporter_message_internal', {
      p_protocol_digest: digest,
      p_body: body,
    })

    if (error) return reply(500, { error: 'message_delivery_failed' })

    if (messageId) {
      const { data: reportId } = await service.rpc('lookup_report_id_internal', { p_protocol_digest: digest })
      if (reportId) {
        try {
          await service.functions.invoke('dispatch-email-notification', {
            body: { organizationId: undefined, eventType: 'report.message.created', objectId: String(reportId) },
          })
        } catch {
          // A mensagem já foi persistida; notificação é best-effort.
        }
      }
    }

    // Resposta uniforme não revela se o protocolo existe.
    return reply(200, { accepted: true })
  } catch {
    return reply(500, { error: 'unexpected_error' })
  }
})
