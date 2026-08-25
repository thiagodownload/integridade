import { createHmac } from 'node:crypto'
import { getVercelOidcToken } from '@vercel/oidc'
import sharp from 'sharp'

const SUPABASE_FUNCTIONS_BASE = 'https://zsxfwcbqbcvuvtcopspt.supabase.co/functions/v1'
const VERCEL_PROJECT = 'canal-integridade'
const VERCEL_TEAM = 'thiagodownload100-9875'
const MAX_ORIGINAL_BYTES = 3 * 1024 * 1024
const MAX_CLEAN_BYTES = 8 * 1024 * 1024
const MAX_PIXELS = 40_000_000

export const config = { api: { bodyParser: false } }

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

function cleanFileName(value: string): string {
  const last = value.split(/[\\/]/).pop() ?? 'imagem'
  return last
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 180) || 'imagem'
}

async function readRawBody(req: any): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_ORIGINAL_BYTES) throw new Error('payload_too_large')
    return req.body
  }
  if (req.body instanceof Uint8Array) {
    const body = Buffer.from(req.body)
    if (body.length > MAX_ORIGINAL_BYTES) throw new Error('payload_too_large')
    return body
  }

  const contentLength = Number(firstHeader(req.headers?.['content-length']) || 0)
  if (contentLength > MAX_ORIGINAL_BYTES) throw new Error('payload_too_large')

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_ORIGINAL_BYTES) throw new Error('payload_too_large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function mimeForFormat(format?: string): string | null {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  return null
}

export default async function handler(req: any, res: any) {
  responseHeaders(res)
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
    return
  }

  const attachmentToken = firstHeader(req.headers?.['x-attachment-token']).trim()
  const originalName = cleanFileName(decodeURIComponent(firstHeader(req.headers?.['x-file-name']) || 'imagem'))
  if (!attachmentToken || attachmentToken.length > 256) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'invalid_attachment_session' }))
    return
  }

  const token = await oidcToken()
  if (!token) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'gateway_identity_unavailable' }))
    return
  }

  try {
    const original = await readRawBody(req)
    if (original.length < 1) throw new Error('invalid_attachment')

    const image = sharp(original, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
    const metadata = await image.metadata()
    const originalMime = mimeForFormat(metadata.format)
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (!originalMime || !width || !height || width * height > MAX_PIXELS) throw new Error('unsupported_attachment_type')

    const clean = await image
      .rotate()
      .webp({ lossless: true, effort: 4 })
      .toBuffer()

    if (clean.length < 1 || clean.length > MAX_CLEAN_BYTES) throw new Error('sanitized_attachment_too_large')

    const form = new FormData()
    form.append('original', new Blob([original], { type: originalMime }), originalName)
    form.append('clean', new Blob([clean], { type: 'image/webp' }), 'sanitized.webp')
    form.append('originalName', originalName)
    form.append('originalMime', originalMime)

    const upstream = await fetch(`${SUPABASE_FUNCTIONS_BASE}/upload-report-attachment`, {
      method: 'POST',
      headers: {
        'x-vercel-oidc-token': token,
        'x-gateway-ip-digest': ipDigest(req, token),
        'x-attachment-token': attachmentToken,
      },
      body: form,
    })

    const text = await upstream.text()
    res.statusCode = upstream.status
    res.end(text || JSON.stringify({ error: 'empty_upstream_response' }))
  } catch (error) {
    const code = error instanceof Error ? error.message : 'invalid_attachment'
    const status = code === 'payload_too_large' || code === 'sanitized_attachment_too_large' ? 413 : 400
    res.statusCode = status
    res.end(JSON.stringify({ error: code }))
  }
}
