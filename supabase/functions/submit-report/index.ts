import { createClient } from 'npm:@supabase/supabase-js@2'
import { encryptContact, generateProtocol, loadPublicCryptoMaterial, protocolDigest, requiredEnv } from '../_shared/security.ts'
import { GatewayAuthError, gatewayIdentityDigest, verifyVercelGateway } from '../_shared/vercel-gateway.ts'

type Input = {
  organizationSlug: string
  categoryId?: string
  relationship?: string
  location?: string
  occurredOn?: string
  ongoing?: boolean
  description: string
  peopleInvolved?: string
  notificationEmail?: string
  goodFaith: boolean
}

const responseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

class InputError extends Error {
  constructor(public code: string) { super(code) }
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders })
}

function optionalText(value: unknown, maxLength: number, code: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new InputError(code)
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new InputError(code)
  return normalized
}

function optionalDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError('invalid_occurred_on')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new InputError('invalid_occurred_on')
  return value
}

function mapRpcError(message: string): { status: number; code: string } | null {
  if (message.includes('organization_not_found')) return { status: 404, code: 'organization_not_found' }
  if (message.includes('anonymous_reporting_disabled')) return { status: 403, code: 'anonymous_reporting_disabled' }
  if (message.includes('optional_email_disabled')) return { status: 400, code: 'optional_email_disabled' }
  if (message.includes('invalid_category')) return { status: 400, code: 'invalid_category' }
  if (message.includes('invalid_encrypted_contact')) return { status: 500, code: 'contact_encryption_failed' }
  return null
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function generateAttachmentToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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
      p_action: 'submit_report',
      p_limit: 5,
      p_window_seconds: 3600,
    })
    if (rateError) return reply(503, { error: 'rate_limit_unavailable' })
    if (rateAllowed !== true) return reply(429, { error: 'too_many_requests' })

    const input = await req.json() as Input
    if (!input || typeof input !== 'object') throw new InputError('invalid_payload')
    if (input.goodFaith !== true) throw new InputError('good_faith_required')
    if (typeof input.organizationSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.organizationSlug)) throw new InputError('invalid_organization')
    if (typeof input.description !== 'string') throw new InputError('invalid_description')

    const description = input.description.trim()
    if (description.length < 20 || description.length > 20000) throw new InputError('invalid_description')

    const relationship = optionalText(input.relationship, 200, 'invalid_relationship')
    const locationText = optionalText(input.location, 300, 'invalid_location')
    const peopleInvolved = optionalText(input.peopleInvolved, 8000, 'invalid_people_involved')
    const occurredOn = optionalDate(input.occurredOn)
    if (input.ongoing !== undefined && typeof input.ongoing !== 'boolean') throw new InputError('invalid_ongoing')

    let categoryId: string | null = null
    if (input.categoryId !== undefined && input.categoryId !== null && input.categoryId !== '') {
      if (typeof input.categoryId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.categoryId)) throw new InputError('invalid_category')
      categoryId = input.categoryId
    }

    let email: string | null = null
    if (input.notificationEmail !== undefined && input.notificationEmail !== null && input.notificationEmail !== '') {
      if (typeof input.notificationEmail !== 'string') throw new InputError('invalid_email')
      email = input.notificationEmail.trim().toLowerCase()
      if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('invalid_email')
    }

    const cryptoMaterial = await loadPublicCryptoMaterial(service)
    const protocol = generateProtocol()
    const digest = await protocolDigest(protocol, cryptoMaterial.protocolPepper)
    const encrypted = email ? await encryptContact(email, cryptoMaterial.contactEncryptionKey) : null

    const { data: reportId, error } = await service.rpc('create_report_internal', {
      p_organization_slug: input.organizationSlug,
      p_category_id: categoryId,
      p_relationship: relationship,
      p_location_text: locationText,
      p_occurred_on: occurredOn,
      p_ongoing: typeof input.ongoing === 'boolean' ? input.ongoing : null,
      p_description: description,
      p_people_involved: peopleInvolved,
      p_protocol_digest: digest,
      p_email_ciphertext: encrypted?.ciphertext ?? null,
      p_email_nonce: encrypted?.nonce ?? null,
      p_email_enabled: Boolean(email),
    })

    if (error) {
      const mapped = mapRpcError(error.message)
      if (mapped) return reply(mapped.status, { error: mapped.code })
      throw error
    }

    let attachmentToken: string | null = null

    if (reportId) {
      try {
        const { data: report } = await service.from('reports').select('organization_id,restricted').eq('id', reportId).maybeSingle()
        if (report?.organization_id) {
          const { data: settings } = await service.from('site_settings')
            .select('allow_attachments')
            .eq('organization_id', report.organization_id)
            .maybeSingle()

          if (settings?.allow_attachments === true) {
            const candidate = generateAttachmentToken()
            const tokenDigest = await sha256Hex(candidate)
            const { error: sessionError } = await service.rpc('create_public_attachment_session_internal', {
              p_report_id: String(reportId),
              p_token_digest: tokenDigest,
              p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            })
            if (!sessionError) attachmentToken = candidate
          }

          await service.functions.invoke('dispatch-email-notification', {
            body: {
              organizationId: String(report.organization_id),
              eventType: report.restricted ? 'report.restricted.created' : 'report.created',
              objectId: String(reportId),
            },
          })
        }
      } catch {
        // O relato já foi persistido. Sessão de anexos e aviso interno são best-effort.
      }
    }

    return reply(201, attachmentToken ? { protocol, attachmentToken } : { protocol })
  } catch (error) {
    if (error instanceof GatewayAuthError) return reply(error.status, { error: error.code })
    if (error instanceof InputError) return reply(400, { error: error.code })
    return reply(500, { error: 'unexpected_error' })
  }
})
