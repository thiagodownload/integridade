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
      p_action: 'lookup_report',
      p_limit: 30,
      p_window_seconds: 900,
    })
    if (rateError) return reply(503, { error: 'rate_limit_unavailable' })
    if (rateAllowed !== true) return reply(429, { error: 'too_many_requests' })

    const body = await req.json()
    const normalized = typeof body?.protocol === 'string' ? body.protocol.trim().toUpperCase() : ''
    if (!protocolPattern.test(normalized)) return reply(400, { error: 'invalid_protocol' })

    const cryptoMaterial = await loadPublicCryptoMaterial(service)
    const digest = await protocolDigest(normalized, cryptoMaterial.protocolPepper)
    const { data: reportId, error: lookupError } = await service.rpc('lookup_report_id_internal', {
      p_protocol_digest: digest,
    })
    if (lookupError) throw lookupError

    if (!reportId) return reply(200, { found: false })

    const [{ data: report, error: reportError }, { data: events, error: eventsError }, { data: messages, error: messagesError }] = await Promise.all([
      service.from('reports').select('status,created_at,closed_at').eq('id', reportId).maybeSingle(),
      service.from('report_events').select('event_type,public_summary,created_at').eq('report_id', reportId).not('public_summary', 'is', null).order('created_at', { ascending: true }),
      service.from('report_messages').select('id,author_type,body,created_at').eq('report_id', reportId).eq('visibility', 'reporter_visible').order('created_at', { ascending: true }),
    ])

    if (reportError || eventsError || messagesError || !report) throw reportError || eventsError || messagesError || new Error('report_not_found')

    return reply(200, {
      found: true,
      report: {
        status: report.status,
        createdAt: report.created_at,
        closedAt: report.closed_at,
      },
      timeline: events || [],
      messages: messages || [],
    })
  } catch (error) {
    if (error instanceof GatewayAuthError) return reply(error.status, { error: error.code })
    return reply(500, { error: 'unexpected_error' })
  }
})
