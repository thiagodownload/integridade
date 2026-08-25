import { createClient } from 'npm:@supabase/supabase-js@2'

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

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function downloadName(value: string): string {
  const clean = value
    .split(/[\\/]/).pop()!
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 150) || 'anexo'
  const base = clean.replace(/\.[^.]+$/, '') || 'anexo'
  return `${base}.sanitizado.webp`
}

type Input = { attachmentId?: unknown }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  try {
    const origin = req.headers.get('origin')
    if (origin && origin !== APP_ORIGIN) return reply(403, { error: 'origin_not_allowed' })

    const authorization = req.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'authentication_required' })

    const input = await req.json() as Input
    const attachmentId = typeof input.attachmentId === 'string' ? input.attachmentId : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachmentId)) {
      return reply(400, { error: 'invalid_attachment_id' })
    }

    const url = requiredEnv('SUPABASE_URL')
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    if (!publicKey) return reply(500, { error: 'public_key_unavailable' })

    const userClient = createClient(url, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: descriptor, error: descriptorError } = await userClient.rpc('operations_get_attachment_download', {
      p_attachment_id: attachmentId,
    })
    if (descriptorError || !descriptor || typeof descriptor !== 'object') return reply(403, { error: 'attachment_access_denied' })

    const item = descriptor as Record<string, unknown>
    const bucket = typeof item.bucket === 'string' ? item.bucket : ''
    const path = typeof item.path === 'string' ? item.path : ''
    const name = typeof item.name === 'string' ? item.name : 'anexo'
    if (bucket !== 'report-attachments-clean' || !path) return reply(500, { error: 'attachment_descriptor_invalid' })

    const service = createClient(url, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: signed, error: signedError } = await service.storage.from(bucket).createSignedUrl(path, 60, {
      download: downloadName(name),
    })
    if (signedError || !signed?.signedUrl) return reply(500, { error: 'signed_url_failed' })

    return reply(200, { url: signed.signedUrl, expiresIn: 60 })
  } catch {
    return reply(500, { error: 'unexpected_error' })
  }
})
