import { createClient } from 'npm:@supabase/supabase-js@2'
import { jsonHeaders, protocolDigest, requiredEnv } from '../_shared/security.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })

  try {
    const { protocol } = await req.json()
    if (typeof protocol !== 'string' || protocol.length < 16 || protocol.length > 64) {
      return new Response(JSON.stringify({ error: 'invalid_protocol' }), { status: 400, headers: jsonHeaders })
    }

    const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const digest = await protocolDigest(protocol)
    const { data: link } = await supabase.from('report_protocols').select('report_id').eq('protocol_digest', digest).maybeSingle()

    // Resposta uniforme reduz enumeração de protocolos.
    if (!link) return new Response(JSON.stringify({ found: false }), { status: 200, headers: jsonHeaders })

    const { data: report } = await supabase.from('reports').select('id,status,created_at,closed_at').eq('id', link.report_id).single()
    const { data: events } = await supabase.from('report_events').select('event_type,public_summary,created_at').eq('report_id', link.report_id).not('public_summary','is',null).order('created_at', { ascending: true })
    const { data: messages } = await supabase.from('report_messages').select('id,author_type,body,created_at').eq('report_id', link.report_id).eq('visibility','reporter_visible').order('created_at', { ascending: true })

    return new Response(JSON.stringify({
      found: true,
      report: { status: report?.status, createdAt: report?.created_at, closedAt: report?.closed_at },
      timeline: events || [],
      messages: messages || []
    }), { status: 200, headers: jsonHeaders })
  } catch {
    return new Response(JSON.stringify({ error: 'unexpected_error' }), { status: 500, headers: jsonHeaders })
  }
})
