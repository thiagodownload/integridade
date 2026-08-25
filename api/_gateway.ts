import { createHmac } from 'node:crypto'
import { getVercelOidcToken } from '@vercel/oidc'

const SUPABASE_FUNCTIONS_BASE = 'https://zsxfwcbqbcvuvtcopspt.supabase.co/functions/v1'
const VERCEL_PROJECT = 'canal-integridade'
const VERCEL_TEAM = 'thiagodownload100-9875'

function firstHeader(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return typeof value === 'string' ? value : ''
}

function clientIp(req: any): string {
  const forwarded = firstHeader(req.headers?.['x-forwarded-for'])
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  const real = firstHeader(req.headers?.['x-real-ip'])
  return real.trim() || 'unknown'
}

async function oidcToken(): Promise<string> {
  const environmentToken = process.env.VERCEL_OIDC_TOKEN ?? ''
  if (environmentToken) return environmentToken

  try {
    return await getVercelOidcToken({
      project: VERCEL_PROJECT,
      team: VERCEL_TEAM,
      expirationBufferMs: 30_000,
    })
  } catch {
    return ''
  }
}

function ipDigest(req: any, token: string): string {
  return createHmac('sha256', token)
    .update(`integridade-public-gateway-v1:${clientIp(req)}`)
    .digest('base64url')
}

function responseHeaders(res: any) {
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-content-type-options', 'nosniff')
}

function parsedBody(req: any): unknown {
  if (req.body == null || req.body === '') return {}
  if (typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return {}
}

export async function proxyPublicFunction(
  req: any,
  res: any,
  functionName: string,
  maxBytes = 64_000,
  allowedMethods: string[] = ['POST'],
) {
  responseHeaders(res)

  if (!allowedMethods.includes(String(req.method ?? ''))) {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
    return
  }

  const token = await oidcToken()
  if (!token) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'gateway_identity_unavailable' }))
    return
  }

  let body: unknown
  try {
    body = req.method === 'GET' ? {} : parsedBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'invalid_json' }))
    return
  }

  const serialized = JSON.stringify(body)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    res.statusCode = 413
    res.end(JSON.stringify({ error: 'payload_too_large' }))
    return
  }

  if (body && typeof body === 'object' && '_website' in body && String((body as Record<string, unknown>)._website ?? '').trim()) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'invalid_request' }))
    return
  }

  try {
    const upstream = await fetch(`${SUPABASE_FUNCTIONS_BASE}/${functionName}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vercel-oidc-token': token,
        'x-gateway-ip-digest': ipDigest(req, token),
      },
      body: serialized,
    })

    const text = await upstream.text()
    res.statusCode = upstream.status
    res.end(text || JSON.stringify({ error: 'empty_upstream_response' }))
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'gateway_upstream_unavailable' }))
  }
}
