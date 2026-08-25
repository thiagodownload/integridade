import { createClient } from 'npm:@supabase/supabase-js@2'
import { decryptContact, jsonHeaders, requiredEnv } from '../_shared/security.ts'

async function sendEmail(to: string, subject: string, body: string) {
  const endpoint = requiredEnv('EMAIL_PROVIDER_API_URL')
  const token = requiredEnv('EMAIL_PROVIDER_API_TOKEN')
  const from = requiredEnv('EMAIL_FROM')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ from, to, subject, text: body })
  })
  if (!response.ok) throw new Error(`email_provider_${response.status}`)
}

Deno.serve(async (req) => {
  // Recomenda-se invocação interna/cron com autenticação por secret, não endpoint público.
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })

  const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: jobs } = await supabase.from('notification_outbox')
    .select('id,report_id,event_type,recipient_reporter,channel,payload,attempts')
    .is('sent_at', null).is('failed_at', null).lte('available_at', new Date().toISOString()).order('id').limit(20)

  for (const job of jobs || []) {
    try {
      if (job.channel === 'email' && job.recipient_reporter && job.report_id) {
        const { data: contact } = await supabase.from('report_contacts').select('email_ciphertext,email_nonce,email_enabled').eq('report_id', job.report_id).maybeSingle()
        if (contact?.email_enabled && contact.email_ciphertext && contact.email_nonce) {
          const email = await decryptContact(contact.email_ciphertext, contact.email_nonce)
          // Conteúdo deliberadamente genérico. Não vazar categoria, nomes ou descrição no e-mail.
          await sendEmail(email, 'Há uma atualização no seu protocolo', 'Seu protocolo no Canal de Integridade recebeu uma atualização. Acesse o canal e consulte usando seu protocolo privado.')
        }
      }
      await supabase.from('notification_outbox').update({ sent_at: new Date().toISOString(), attempts: job.attempts + 1, last_error: null }).eq('id', job.id)
    } catch (error) {
      const attempts = job.attempts + 1
      await supabase.from('notification_outbox').update({
        attempts,
        last_error: String(error).slice(0, 800),
        failed_at: attempts >= 5 ? new Date().toISOString() : null,
        available_at: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString()
      }).eq('id', job.id)
    }
  }

  return new Response(JSON.stringify({ processed: jobs?.length || 0 }), { headers: jsonHeaders })
})
