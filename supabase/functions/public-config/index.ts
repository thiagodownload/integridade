import { createClient } from 'npm:@supabase/supabase-js@2'
import { requiredEnv } from '../_shared/security.ts'
import { GatewayAuthError, gatewayIdentityDigest, verifyVercelGateway } from '../_shared/vercel-gateway.ts'

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  try {
    await verifyVercelGateway(req)
    const identityDigest = gatewayIdentityDigest(req)
    const service = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: allowed, error: rateError } = await service.rpc('claim_public_rate_limit_internal', {
      p_identity_digest: identityDigest,
      p_action: 'public_config',
      p_limit: 120,
      p_window_seconds: 600,
    })
    if (rateError) return reply(503, { error: 'rate_limit_unavailable' })
    if (allowed !== true) return reply(429, { error: 'too_many_requests' })

    const { data, error } = await service.rpc('get_public_form_config_internal')
    if (error || !data) return reply(503, { error: 'public_config_unavailable' })

    return reply(200, { config: data })
  } catch (error) {
    if (error instanceof GatewayAuthError) return reply(error.status, { error: error.code })
    return reply(500, { error: 'unexpected_error' })
  }
})
