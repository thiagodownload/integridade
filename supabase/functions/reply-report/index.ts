import { createClient } from 'npm:@supabase/supabase-js@2'
import { loadPublicCryptoMaterial, protocolDigest, requiredEnv } from '../_shared/security.ts'
import { GatewayAuthError, gatewayIdentityDigest, verifyVercelGateway } from '../_shared/vercel-gateway.ts'

const protocolPattern = /^CI-\d{2}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/
const responseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  try {
    await verifyVercelGateway(req)
    const identityDigest = gatewayIdentityDigest(req)
    const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: rateAllowed, error: rateError } = await service.rpc('claim_public_rate_limit_internal', {
      p_identity_digest: identityDigest,
      p_action: 'reply_report',
      p_limit: 20,
      p_window_seconds: 900,
    })
    if (rateError) return reply(503, { error: 'rate_limit_unavailable' })
    if (rateAllowed !== true) return reply(429, { error: 'too_many_requests' })

    const input = await req.json() as { protocol?: unknown; body?: unknown }
    const protocol = typeof input.protocol === 'string' ? input.protocol.trim().toUpperCase() : ''
    const body = typeof input.body === 'string' ? input.body.trim() : ''

    if (!protocolPattern.test(protocol)) return reply(400, { error: 'invalid_protocol' })
    if (!body || body.length > 8000) return reply(400, { error: 'invalid_message_body' })

    const cryptoMaterial = await loadPublicCryptoMaterial(service)
    const digest = await protocolDigest(protocol, cryptoMaterial.protocolPepper)
    const { data: messageId, error } = await service.rpc('add_reporter_message_internal', {
      p_protocol_digest: digest,
      p_body: body,
    })
    if (error) return reply(500, { error: 'message_delivery_failed' })

    if (messageId) {
      const { data: reportId } = await service.rpc('lookup_report_id_internal', { p_protocol_digest: digest })
      if (reportId) {
        const { data: report } = await service.from('reports').select('organization_id').eq('id', reportId).maybeSingle()
        if (report?.organization_id) {
          try {
            await service.functions.invoke('dispatch-email-notification', {
              body: {
                organizationId: String(report.organization_id),
                eventType: 'report.message.created',
                objectId: String(reportId),
              },
            })
          } catch {
            // A mensagem já foi persistida; notificação interna é best-effort.
          }
        }
      }
    }

    return reply(200, { accepted: true })
  } catch (error) {
    if (error instanceof GatewayAuthError) return reply(error.status, { error: error.code })
    return reply(500, { error: 'unexpected_error' })
  }
})
