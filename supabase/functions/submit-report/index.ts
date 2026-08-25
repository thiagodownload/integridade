import { createClient } from 'npm:@supabase/supabase-js@2'
import { encryptContact, generateProtocol, jsonHeaders, protocolDigest, requiredEnv } from '../_shared/security.ts'

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })

  try {
    const input = await req.json() as Input
    if (!input.goodFaith || !input.description?.trim() || input.description.length > 20000) {
      return new Response(JSON.stringify({ error: 'invalid_payload' }), { status: 400, headers: jsonHeaders })
    }

    // IMPORTANTE: em produção, esta função deve ficar atrás de um privacy gateway com proteção antiabuso.
    // Não registrar corpo, IP, user-agent ou protocolo em console.
    const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const { data: org, error: orgError } = await supabase.from('organizations').select('id').eq('slug', input.organizationSlug).single()
    if (orgError || !org) return new Response(JSON.stringify({ error: 'organization_not_found' }), { status: 404, headers: jsonHeaders })

    let priority = 'medium'
    let restricted = false
    if (input.categoryId) {
      const { data: category } = await supabase.from('report_categories').select('severity_default, restricted_by_default').eq('id', input.categoryId).eq('organization_id', org.id).eq('active', true).maybeSingle()
      if (category) {
        priority = category.severity_default
        restricted = category.restricted_by_default
      }
    }

    const { data: report, error: reportError } = await supabase.from('reports').insert({
      organization_id: org.id,
      category_id: input.categoryId || null,
      status: 'new',
      priority,
      restricted,
      relationship: input.relationship?.slice(0, 200) || null,
      location_text: input.location?.slice(0, 300) || null,
      occurred_on: input.occurredOn || null,
      ongoing: typeof input.ongoing === 'boolean' ? input.ongoing : null,
      description: input.description.trim(),
      people_involved: input.peopleInvolved?.slice(0, 8000) || null
    }).select('id').single()

    if (reportError || !report) throw reportError || new Error('report_insert_failed')

    const protocol = generateProtocol()
    const digest = await protocolDigest(protocol)
    const { error: protocolError } = await supabase.from('report_protocols').insert({ report_id: report.id, protocol_digest: digest })
    if (protocolError) throw protocolError

    if (input.notificationEmail?.trim()) {
      const email = input.notificationEmail.trim().toLowerCase()
      if (email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) return new Response(JSON.stringify({ error: 'invalid_email' }), { status: 400, headers: jsonHeaders })
      const encrypted = await encryptContact(email)
      const { error: contactError } = await supabase.from('report_contacts').insert({
        report_id: report.id,
        email_ciphertext: encrypted.ciphertext,
        email_nonce: encrypted.nonce,
        email_enabled: true
      })
      if (contactError) throw contactError
    }

    await supabase.from('report_events').insert({ report_id: report.id, event_type: 'report_received', public_summary: 'Relato recebido e encaminhado para triagem.' })
    await supabase.from('notification_outbox').insert({ organization_id: org.id, report_id: report.id, event_type: 'report_created', channel: 'in_app', payload: { generic: true } })

    return new Response(JSON.stringify({ protocol }), { status: 201, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'unexpected_error' }), { status: 500, headers: jsonHeaders })
  }
})
