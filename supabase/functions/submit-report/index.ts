import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, encryptContact, generateProtocol, jsonHeaders, protocolDigest, requiredEnv } from '../_shared/security.ts'

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

class InputError extends Error {
  constructor(public code: string) {
    super(code)
  }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })

  try {
    const input = await req.json() as Input

    if (!input || typeof input !== 'object') throw new InputError('invalid_payload')
    if (input.goodFaith !== true) throw new InputError('good_faith_required')
    if (typeof input.organizationSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.organizationSlug)) {
      throw new InputError('invalid_organization')
    }
    if (typeof input.description !== 'string') throw new InputError('invalid_description')

    const description = input.description.trim()
    if (!description || description.length > 20000) throw new InputError('invalid_description')

    const relationship = optionalText(input.relationship, 200, 'invalid_relationship')
    const locationText = optionalText(input.location, 300, 'invalid_location')
    const peopleInvolved = optionalText(input.peopleInvolved, 8000, 'invalid_people_involved')
    const occurredOn = optionalDate(input.occurredOn)

    if (input.ongoing !== undefined && typeof input.ongoing !== 'boolean') throw new InputError('invalid_ongoing')

    let categoryId: string | null = null
    if (input.categoryId !== undefined && input.categoryId !== null && input.categoryId !== '') {
      if (typeof input.categoryId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.categoryId)) {
        throw new InputError('invalid_category')
      }
      categoryId = input.categoryId
    }

    let email: string | null = null
    if (input.notificationEmail !== undefined && input.notificationEmail !== null && input.notificationEmail !== '') {
      if (typeof input.notificationEmail !== 'string') throw new InputError('invalid_email')
      email = input.notificationEmail.trim().toLowerCase()
      if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('invalid_email')
    }

    // Não registrar corpo, IP, user-agent, e-mail ou protocolo em console.
    // O endpoint público deve ficar atrás do privacy gateway/antiabuso antes de produção.
    const protocol = generateProtocol()
    const digest = await protocolDigest(protocol)
    const encrypted = email ? await encryptContact(email) : null

    const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const { data: reportId, error } = await supabase.rpc('create_report_internal', {
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
      p_email_enabled: Boolean(email)
    })

    if (error) {
      const mapped = mapRpcError(error.message)
      if (mapped) return new Response(JSON.stringify({ error: mapped.code }), { status: mapped.status, headers: jsonHeaders })
      throw error
    }

    // Notificação é best-effort: uma falha de e-mail nunca desfaz ou impede o registro do relato.
    if (reportId) {
      try {
        const { data: report } = await supabase
          .from('reports')
          .select('organization_id,restricted')
          .eq('id', reportId)
          .maybeSingle()

        if (report?.organization_id) {
          await supabase.functions.invoke('dispatch-email-notification', {
            body: {
              organizationId: String(report.organization_id),
              eventType: report.restricted ? 'report.restricted.created' : 'report.created',
              objectId: String(reportId),
            },
          })
        }
      } catch {
        // Sem console: não registrar identificadores ou conteúdo do relato em logs de notificação.
      }
    }

    return new Response(JSON.stringify({ protocol }), { status: 201, headers: jsonHeaders })
  } catch (error) {
    if (error instanceof InputError) {
      return new Response(JSON.stringify({ error: error.code }), { status: 400, headers: jsonHeaders })
    }
    return new Response(JSON.stringify({ error: 'unexpected_error' }), { status: 500, headers: jsonHeaders })
  }
})
