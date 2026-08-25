import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonHeaders, protocolDigest, requiredEnv } from '../_shared/security.ts'

const protocolPattern = /^CI-\d{2}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })

  try {
    const body = await req.json()
    const normalized = typeof body?.protocol === 'string' ? body.protocol.trim().toUpperCase() : ''

    if (!protocolPattern.test(normalized)) {
      return new Response(JSON.stringify({ error: 'invalid_protocol' }), { status: 400, headers: jsonHeaders })
    }

    // Não registrar IP, user-agent, protocolo ou resposta do caso em console.
    const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const digest = await protocolDigest(normalized)
    const { data: reportId, error: lookupError } = await supabase.rpc('lookup_report_id_internal', {
      p_protocol_digest: digest
    })

    if (lookupError) throw lookupError

    // Resposta uniforme reduz enumeração de protocolos. Rate limit/antiabuso será aplicado no privacy gateway.
    if (!reportId) return new Response(JSON.stringify({ found: false }), { status: 200, headers: jsonHeaders })

    const [{ data: report, error: reportError }, { data: events, error: eventsError }, { data: messages, error: messagesError }] = await Promise.all([
      supabase.from('reports').select('status,created_at,closed_at').eq('id', reportId).maybeSingle(),
      supabase.from('report_events').select('event_type,public_summary,created_at').eq('report_id', reportId).not('public_summary', 'is', null).order('created_at', { ascending: true }),
      supabase.from('report_messages').select('id,author_type,body,created_at').eq('report_id', reportId).eq('visibility', 'reporter_visible').order('created_at', { ascending: true })
    ])

    if (reportError || eventsError || messagesError || !report) throw reportError || eventsError || messagesError || new Error('report_not_found')

    return new Response(JSON.stringify({
      found: true,
      report: {
        status: report.status,
        createdAt: report.created_at,
        closedAt: report.closed_at
      },
      timeline: events || [],
      messages: messages || []
    }), { status: 200, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'unexpected_error' }), { status: 500, headers: jsonHeaders })
  }
})
