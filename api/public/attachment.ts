import { createHmac } from 'node:crypto'
import { getVercelOidcToken } from '@vercel/oidc'
import { unzipSync, zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

const SUPABASE_FUNCTIONS_BASE = 'https://zsxfwcbqbcvuvtcopspt.supabase.co/functions/v1'
const VERCEL_PROJECT = 'canal-integridade'
const VERCEL_TEAM = 'thiagodownload100-9875'
const MAX_ORIGINAL_BYTES = 3 * 1024 * 1024
const MAX_CLEAN_BYTES = 8 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const MAX_ZIP_ENTRIES = 2000
const MAX_ZIP_EXPANDED_BYTES = 20 * 1024 * 1024

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

type Sanitized = { originalMime: string; cleanMime: string; clean: Buffer; cleanName: string }

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
    return await getVercelOidcToken({ project: VERCEL_PROJECT, team: VERCEL_TEAM, expirationBufferMs: 30_000 })
  } catch {
    return ''
  }
}

function ipDigest(req: any, token: string): string {
  return createHmac('sha256', token).update(`integridade-public-gateway-v1:${clientIp(req)}`).digest('base64url')
}

function responseHeaders(res: any) {
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-content-type-options', 'nosniff')
}

function cleanFileName(value: string): string {
  const last = value.split(/[\\/]/).pop() ?? 'anexo'
  return last.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || 'anexo'
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

function extension(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  return match?.[1] ?? ''
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

function imageSignature(bytes: Buffer): boolean {
  return (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))
    || (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
}

function mimeForFormat(format?: string): string | null {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  return null
}

async function sanitizeImage(original: Buffer): Promise<Sanitized> {
  const image = sharp(original, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
  const metadata = await image.metadata()
  const originalMime = mimeForFormat(metadata.format)
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!originalMime || !width || !height || width * height > MAX_PIXELS) throw new Error('unsupported_attachment_type')
  const clean = await image.rotate().webp({ lossless: true, effort: 4 }).toBuffer()
  return { originalMime, cleanMime: 'image/webp', clean, cleanName: 'sanitized.webp' }
}

function validateZipCentralDirectory(bytes: Buffer) {
  let total = 0
  let entries = 0
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const uncompressedSize = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    if (compressedSize > MAX_ORIGINAL_BYTES || uncompressedSize > 10 * 1024 * 1024) throw new Error('unsafe_archive_expansion')
    total += uncompressedSize
    entries += 1
    if (total > MAX_ZIP_EXPANDED_BYTES || entries > MAX_ZIP_ENTRIES) throw new Error('unsafe_archive_expansion')
    offset += 45 + nameLength + extraLength + commentLength
  }
  if (entries < 1) throw new Error('invalid_office_document')
}

function sanitizeOffice(original: Buffer, ext: string): Sanitized {
  validateZipCentralDirectory(original)
  const files = unzipSync(new Uint8Array(original))
  const entries = Object.entries(files)
  const names = new Set(entries.map(([name]) => name))
  const mime = ext === 'docx' ? DOCX : ext === 'xlsx' ? XLSX : ext === 'pptx' ? PPTX : ''
  const required = ext === 'docx' ? 'word/document.xml' : ext === 'xlsx' ? 'xl/workbook.xml' : 'ppt/presentation.xml'
  if (!mime || !names.has('[Content_Types].xml') || !names.has(required)) throw new Error('invalid_office_document')

  const forbidden = /(vbaproject|activex|\/embeddings\/|\/externallinks\/|oleobject)/i
  const sanitized: Record<string, Uint8Array> = {}
  for (const [name, data] of entries) {
    if (forbidden.test(name)) throw new Error('unsafe_office_features')
    if (/\.rels$/i.test(name)) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
      if (/TargetMode\s*=\s*["']External["']/i.test(text)) throw new Error('unsafe_office_features')
    }
    if (/^docProps\/(core|custom|app)\.xml$/i.test(name) || /^customXml\//i.test(name)) continue
    sanitized[name] = data
  }

  const clean = Buffer.from(zipSync(sanitized, { level: 6 }))
  return { originalMime: mime, cleanMime: mime, clean, cleanName: `sanitized.${ext}` }
}

async function sanitizePdf(original: Buffer): Promise<Sanitized> {
  if (!original.subarray(0, 8).toString('ascii').startsWith('%PDF-')) throw new Error('invalid_pdf')
  const source = original.toString('latin1')
  if (/\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia|XFA)\b/i.test(source)) throw new Error('unsafe_pdf_features')
  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(original, { ignoreEncryption: false, updateMetadata: false })
  } catch {
    throw new Error('invalid_or_encrypted_pdf')
  }
  pdf.setTitle('')
  pdf.setAuthor('')
  pdf.setSubject('')
  pdf.setKeywords([])
  pdf.setCreator('Canal de Integridade')
  pdf.setProducer('Canal de Integridade')
  const clean = Buffer.from(await pdf.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }))
  return { originalMime: 'application/pdf', cleanMime: 'application/pdf', clean, cleanName: 'sanitized.pdf' }
}

function sanitizeText(original: Buffer, ext: string): Sanitized {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(original) } catch { throw new Error('invalid_text_encoding') }
  if (text.includes('\u0000') || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('unsafe_text_content')
  const clean = Buffer.from(text.replace(/\r\n?/g, '\n'), 'utf8')
  const mime = ext === 'csv' ? 'text/csv' : 'text/plain'
  return { originalMime: mime, cleanMime: mime, clean, cleanName: `sanitized.${ext === 'csv' ? 'csv' : 'txt'}` }
}

function synchsafeSize(bytes: Buffer, offset: number): number {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f)
}

function sanitizeMp3(original: Buffer): Sanitized {
  let start = 0
  let end = original.length
  if (original.length >= 10 && original.toString('ascii', 0, 3) === 'ID3') {
    const tagSize = synchsafeSize(original, 6)
    const hasFooter = (original[5] & 0x10) !== 0
    start = 10 + tagSize + (hasFooter ? 10 : 0)
  }
  if (end - start >= 128 && original.toString('ascii', end - 128, end - 125) === 'TAG') end -= 128
  if (start + 2 > end || original[start] !== 0xff || (original[start + 1] & 0xe0) !== 0xe0) throw new Error('invalid_mp3')
  const clean = original.subarray(start, end)
  return { originalMime: 'audio/mpeg', cleanMime: 'audio/mpeg', clean, cleanName: 'sanitized.mp3' }
}

function wavChunk(id: string, data: Buffer): Buffer {
  const padding = data.length % 2
  const header = Buffer.alloc(8)
  header.write(id, 0, 4, 'ascii')
  header.writeUInt32LE(data.length, 4)
  return Buffer.concat([header, data, padding ? Buffer.from([0]) : Buffer.alloc(0)])
}

function sanitizeWav(original: Buffer): Sanitized {
  if (original.length < 44 || original.toString('ascii', 0, 4) !== 'RIFF' || original.toString('ascii', 8, 12) !== 'WAVE') throw new Error('invalid_wav')
  let offset = 12
  const kept: Buffer[] = []
  let hasFmt = false
  let hasData = false
  let chunkCount = 0
  while (offset + 8 <= original.length) {
    chunkCount += 1
    if (chunkCount > 1000) throw new Error('invalid_wav')
    const id = original.toString('ascii', offset, offset + 4)
    const size = original.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > original.length) throw new Error('invalid_wav')
    if (id === 'fmt ' || id === 'fact' || id === 'data') {
      if (id === 'fmt ') hasFmt = true
      if (id === 'data') hasData = true
      kept.push(wavChunk(id, original.subarray(start, end)))
    }
    offset = end + (size % 2)
  }
  if (!hasFmt || !hasData) throw new Error('invalid_wav')
  const payload = Buffer.concat(kept)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 4, 'ascii')
  header.writeUInt32LE(payload.length + 4, 4)
  header.write('WAVE', 8, 4, 'ascii')
  return { originalMime: 'audio/wav', cleanMime: 'audio/wav', clean: Buffer.concat([header, payload]), cleanName: 'sanitized.wav' }
}

async function sanitize(original: Buffer, name: string): Promise<Sanitized> {
  const ext = extension(name)
  if (imageSignature(original)) return sanitizeImage(original)
  if (original.length >= 5 && original.toString('ascii', 0, 5) === '%PDF-') return sanitizePdf(original)
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') return sanitizeOffice(original, ext)
  if (ext === 'txt' || ext === 'csv') return sanitizeText(original, ext)
  if (original.length >= 12 && original.toString('ascii', 0, 4) === 'RIFF' && original.toString('ascii', 8, 12) === 'WAVE') return sanitizeWav(original)
  if (ext === 'mp3' || original.toString('ascii', 0, 3) === 'ID3' || (original.length >= 2 && original[0] === 0xff && (original[1] & 0xe0) === 0xe0)) return sanitizeMp3(original)
  throw new Error('unsupported_attachment_type')
}

export default async function handler(req: any, res: any) {
  responseHeaders(res)
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'method_not_allowed' })); return }

  const attachmentToken = firstHeader(req.headers?.['x-attachment-token']).trim()
  const originalName = cleanFileName(safeDecode(firstHeader(req.headers?.['x-file-name']) || 'anexo'))
  if (!attachmentToken || attachmentToken.length > 256) { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid_attachment_session' })); return }

  const token = await oidcToken()
  if (!token) { res.statusCode = 503; res.end(JSON.stringify({ error: 'gateway_identity_unavailable' })); return }

  try {
    const original = await readRawBody(req)
    if (original.length < 1) throw new Error('invalid_attachment')
    const sanitized = await sanitize(original, originalName)
    if (sanitized.clean.length < 1 || sanitized.clean.length > MAX_CLEAN_BYTES) throw new Error('sanitized_attachment_too_large')

    const form = new FormData()
    form.append('original', new Blob([original], { type: sanitized.originalMime }), originalName)
    form.append('clean', new Blob([sanitized.clean], { type: sanitized.cleanMime }), sanitized.cleanName)
    form.append('originalName', originalName)
    form.append('originalMime', sanitized.originalMime)
    form.append('cleanMime', sanitized.cleanMime)

    const upstream = await fetch(`${SUPABASE_FUNCTIONS_BASE}/upload-report-attachment`, {
      method: 'POST',
      headers: { 'x-vercel-oidc-token': token, 'x-gateway-ip-digest': ipDigest(req, token), 'x-attachment-token': attachmentToken },
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
